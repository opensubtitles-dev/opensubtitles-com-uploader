---
title: "04 — Unified REST Client Refactor"
aliases: [rest-client, restClient, services-refactor]
tags: [uploader/rest-client, phase-2, refactor]
created: 2026-04-15
status: locked
---

# 04 — Unified REST Client Refactor

> [!INFO] Purpose
> Consolidate the partial REST client (`openSubtitlesApi.js`) and the legacy XML-RPC service (`xmlrpc.js`) into a single, well-factored REST client. Every outbound API call goes through it. Auth, headers, retry, caching, error mapping all handled in one place.

## 1. Shape

```
src/services/api/
├── restClient.js              NEW — low-level HTTP client (auth, retry, errors, rate limit)
├── auth.js                    NEW — login / logout / user info (replaces authService XML-RPC)
├── upload.js                  NEW — check / commit / guess / stub feature
├── myUploads.js               NEW — list / update / delete own uploads
├── features.js                NEW — search + lookup (replaces SearchMovies / suggest_imdb)
├── languages.js               NEW — infos/languages
├── languageDetection.js       (rename from openSubtitlesApi helpers for detectLanguage)
└── legacy/                    intermediate-only — deleted at end of Phase 2
    ├── xmlrpc.js              (current file moves here during gradual migration)
    └── openSubtitlesApi.js    (current file moves here — content gets migrated)
```

**End state after Phase 2:** `legacy/` directory is deleted. Only 7 files in `api/`.

## 2. `restClient.js` — low-level contract

```js
import { API_ENDPOINTS, OPENSUBTITLES_COM_API_KEY, getApiHeaders } from '../../utils/constants.js';
import { delayedFetch } from '../../utils/networkUtils.js';
import { retryAsync } from '../../utils/retryUtils.js';
import authStore from './authStore.js';

export class RestError extends Error {
  constructor(code, message, status, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class AuthError extends RestError {
  constructor(message = 'Authentication required') {
    super('unauthorized', message, 401);
    this.name = 'AuthError';
  }
}

export class RestClient {
  constructor({ baseUrl, apiKey } = {}) {
    this.baseUrl = baseUrl ?? API_ENDPOINTS.OPENSUBTITLES_REST;
    this.apiKey  = apiKey  ?? OPENSUBTITLES_COM_API_KEY;
  }

  buildHeaders({ authenticated = 'auto', contentType = 'application/json', extra = {} } = {}) {
    const h = getApiHeaders(contentType, { 'Api-Key': this.apiKey, ...extra });
    const jwt = authStore.getToken();
    if (jwt && authenticated !== false) h['Authorization'] = `Bearer ${jwt}`;
    return h;
  }

  async request(method, path, { body, query, authenticated = 'auto', retries = 1, signal } = {}) {
    const url = this.buildUrl(path, query);
    const opts = {
      method,
      headers: this.buildHeaders({ authenticated, contentType: body instanceof FormData ? undefined : 'application/json' }),
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
      signal,
    };

    return retryAsync(async () => {
      const res = await delayedFetch(url, opts);

      // 401 — clear auth + bubble as AuthError
      if (res.status === 401 && authenticated !== false) {
        authStore.onAuthExpired();
        throw new AuthError();
      }

      // 429 — surface quota error
      if (res.status === 429) {
        const data = await this.safeJson(res);
        throw new RestError('quota_exceeded', data?.message ?? 'Rate limited', 429, data);
      }

      // 4xx / 5xx — structured error
      if (!res.ok) {
        const data = await this.safeJson(res);
        throw new RestError(
          data?.error_code ?? `http_${res.status}`,
          data?.message ?? res.statusText,
          res.status,
          data ?? {}
        );
      }

      return this.safeJson(res);
    }, { retries });
  }

  get    (p, opts)       { return this.request('GET',    p, opts); }
  post   (p, body, opts) { return this.request('POST',   p, { ...opts, body }); }
  patch  (p, body, opts) { return this.request('PATCH',  p, { ...opts, body }); }
  delete (p, opts)       { return this.request('DELETE', p, opts); }

  buildUrl(path, query) {
    const u = new URL(this.baseUrl.replace(/\/$/, '') + path);
    if (query) Object.entries(query).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
    return u.toString();
  }

  async safeJson(res) { try { return await res.json(); } catch { return null; } }
}

export const restClient = new RestClient();
```

### 2.1 Why `authStore` is a module, not an import from `authService`

Circular dependency avoidance. `authService` wraps `restClient`; `restClient` needs a way to read the current JWT without importing `authService` back. `authStore` is a tiny module:

```js
// src/services/api/authStore.js
let _token = null;
let _onExpired = () => {};
export default {
  getToken: () => _token,
  setToken: (t) => { _token = t; },
  onAuthExpired: () => _onExpired(),
  registerOnExpired: (fn) => { _onExpired = fn; },
};
```

`authService` at init time: `authStore.setToken(hydratedJwt); authStore.registerOnExpired(() => this.onAuthExpired());`.

## 3. `auth.js`

```js
import { restClient } from './restClient.js';

export const authApi = {
  async login({ username, password }) {
    return restClient.post('/login', { username, password }, { authenticated: false });
  },

  async logout() {
    // If server-side logout exists, call it. Otherwise no-op; client clears locally.
    try {
      await restClient.delete('/logout');
    } catch (e) {
      if (e.code !== 'http_404') throw e;  // endpoint may not exist
    }
  },

  async getUserInfo() {
    return restClient.get('/infos/user');
  },
};
```

## 4. `upload.js`

```js
import { restClient } from './restClient.js';

export const uploadApi = {
  async check(payload, { anonymous = false } = {}) {
    return restClient.post('/subtitles/upload/check', payload, { authenticated: !anonymous ? 'auto' : false });
  },

  async commit(payload, { anonymous = false } = {}) {
    return restClient.post('/subtitles/upload', payload, { authenticated: !anonymous ? 'auto' : false });
  },

  async guess(filename, moviehash = null, { anonymous = false } = {}) {
    return restClient.post('/subtitles/upload/guess', { filename, moviehash }, { authenticated: !anonymous ? 'auto' : false });
  },

  async createStubFeature({ title, year, type }) {
    return restClient.post('/subtitles/upload/features/stub', { title, year, type });
  },
};
```

## 5. `myUploads.js`

```js
import { restClient } from './restClient.js';

export const myUploadsApi = {
  async list({ page = 1, perPage = 20, languageCode, enabled } = {}) {
    return restClient.get('/my/uploads', {
      query: { page, per_page: perPage, language_code: languageCode, enabled },
    });
  },

  async update(id, patch) {
    return restClient.patch(`/my/uploads/${id}`, patch);
  },

  async remove(id) {
    return restClient.delete(`/my/uploads/${id}`);
  },
};
```

## 6. `features.js`

```js
import { restClient } from './restClient.js';
import { CacheService } from '../cache.js';

const CACHE_FEATURES = 'rest_features_cache';

export const featuresApi = {
  async searchByQuery(query, { signal } = {}) {
    return restClient.get('/features', { query: { query }, signal });
  },

  async byImdbId(imdbId) {
    const cached = CacheService.get(`${CACHE_FEATURES}:imdb:${imdbId}`);
    if (cached) return cached;
    const data = await restClient.get('/features', { query: { imdb_id: imdbId } });
    CacheService.set(`${CACHE_FEATURES}:imdb:${imdbId}`, data, /* ttl */ 24 * 3600 * 1000);
    return data;
  },
};
```

## 7. `languages.js`

```js
import { restClient } from './restClient.js';
import { CacheService } from '../cache.js';

const CACHE_KEY = 'rest_languages_cache';
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

export const languagesApi = {
  async list() {
    const cached = CacheService.get(CACHE_KEY);
    if (cached) return cached;
    const data = await restClient.get('/infos/languages', { authenticated: false });
    CacheService.set(CACHE_KEY, data, CACHE_TTL_MS);
    return data;
  },
};
```

## 8. Caching strategy

### 8.1 Cache key prefix `rest_*`
All new caches use the `rest_` prefix to disambiguate from `opensubtitles_*` and `opensubtitles_xmlrpc_*` legacy keys. Migration logic in [[03-auth-migration#Storage key rotation]] nukes the legacy ones on first run.

### 8.2 TTLs
| Cache | Key | TTL |
|---|---|---|
| Languages | `rest_languages_cache` | 7 days |
| Features by IMDb ID | `rest_features_cache:imdb:<id>` | 24h |
| Movie guess | `rest_movie_guess_cache:<filename-hash>` | 72h (unchanged) |
| Check/dedup | `rest_check_cache:<subhash>` | 24h |
| User info | (in-memory only, already 1h) | 1h |
| Language detection | `rest_lang_detect_cache:<file-md5>` | 30 days |
| GuessIt | `rest_guessit_cache:<filename>` | 30 days |

## 9. Rate limiting & delays

Preserve `delayedFetch` (100ms global minimum) — it's belt-and-braces protection, not endpoint-specific. Server rate limits itself, client courtesy delay is backup.

Per-endpoint delays in the current code (e.g. 3s between movie guesses) get deleted — the server handles its own rate limiting, client retries on 429.

## 10. Error handling in the client

Callers should:
```js
try {
  const result = await uploadApi.commit(payload);
} catch (e) {
  if (e instanceof AuthError) { /* show login */ }
  else if (e.code === 'duplicate') { /* dup flow */ }
  else if (e.code === 'quota_exceeded') { /* upgrade CTA */ }
  else { /* generic error */ }
}
```

See [[07-error-mapping]] for the full error code table.

## 11. Migration steps (incremental)

We don't delete `xmlrpc.js` on day one. We ghost-build the new client alongside and cut over endpoint-by-endpoint. Canonical order in [[09-migration-sequence]].

1. Land `restClient.js` + `authStore.js` (no behavior change — not used yet)
2. Land `languages.js`, rewire `useLanguageData.js` (easy win, one callsite)
3. Land `features.js`, rewire `useMovieSearch.js`
4. Land `auth.js`, rewire `authService.js` + `AuthContext.jsx` (big swap)
5. Land `upload.js#guess`, rewire `useMovieGuess.js`
6. Land `upload.js#check`, rewire `useCheckSubHash.js`
7. Land `upload.js#commit`, rewire `subtitleUploadService.js`
8. Land `myUploads.js` + new `UploadHistory.jsx` component
9. Land `upload.js#createStubFeature` + UI CTA
10. Delete `xmlrpc.js` + `openSubtitlesApi.js` (move to `legacy/` first, then remove in a final commit)

    > [!warning] Status (2026-05-26): PARTIAL
    > - ✅ `src/services/xmlrpc.js` — **deleted**. Not present on disk;
    >   `ls src/services/` returns no `xmlrpc.js`. The intermediate
    >   `src/services/legacy/` directory never materialised either
    >   (the migration went straight to removal rather than the staged
    >   move described above).
    > - ✅ Legacy adapter functions (`adaptLegacyCheckPayload`,
    >   `adaptLegacyCommitPayload`, `restCheckResponseToLegacy`,
    >   `restCommitResponseToLegacy`) removed from `src/services/api/upload.js`
    >   — see the tombstone comment at `upload.js:230-244` ("Phase E step 5,
    >   2026-05-06").
    > - ⏳ `src/services/api/openSubtitlesApi.js` — **still on disk**
    >   (~19 KB, recent mtime). Phase E loose-end; needs to be audited for
    >   remaining callers, gutted, and removed before Phase 2 closes.
    >   Treat as the last item on the REST refactor checklist.

Each step lands as an isolated commit — easy to bisect if a regression appears on staging.

## 12. Existing utilities that stay

| File | Why it stays |
|---|---|
| `networkUtils.js` (`delayedFetch`) | Global rate-limit guard — reused |
| `retryUtils.js` (`retryAsync`) | Generic retry — reused |
| `securityUtils.js` | Token-safe logging — still relevant |
| `cache.js` (`CacheService`) | Generic localStorage cache with expiry — reused |

## 13. Dependency cleanup (post-migration)

Remove when XML-RPC is gone:
- `crypto-js` → no more MD5 password hashing (check `subtitleHash.js` first — MD5 of subcontent is still needed)
- Any `DOMParser` specific tests — no more XML parsing

Keep:
- `pako` — gzip compression of `subcontent` stays
- `buffer` — base64 utilities
- `crypto-js` if `subtitleHash.js` needs MD5 for subhash computation (verify before deleting)

## 14. Tests to add alongside

See [[08-testing-strategy#REST client tests]]. Highlights:
- Mock fetch, assert header shape (Api-Key + Authorization when authenticated, only Api-Key when anon)
- 401 triggers `authStore.onAuthExpired()`
- 429 throws `RestError('quota_exceeded', ...)`
- Retry runs on network error but not on 4xx
- Unicode in query params survives URL encoding
