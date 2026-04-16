---
title: "01 — Current State Audit"
aliases: [audit, current-state, baseline]
tags: [uploader/audit, phase-2, baseline]
created: 2026-04-15
status: locked
---

# 01 — Current State Audit

> [!INFO] Purpose
> Lock-down snapshot of every API call, every auth code path, every storage key the uploader currently touches. **Everything downstream ([[02-endpoint-mapping]], [[03-auth-migration]], etc.) references this doc by `file.js:line`.** If something here is wrong, downstream plans are wrong.
>
> Last verified: 2026-04-15 against commit at `/Users/juju/Dropbox/Brano-Julien-Stuff/custom-gems/opensubtitles-com-uploader`.

## 1. Stack

- **Tauri v2** desktop shell (Rust host, `src-tauri/`)
- **React 18** + Vite 5 + Tailwind CSS
- **Auto-updater** via `@tauri-apps/plugin-updater`
- **HTTP** via `@tauri-apps/plugin-http` + browser `fetch`
- **crypto-js** for MD5 password hashing (will be removed — see [[03-auth-migration#MD5 removal]])
- **guessit-js** (client-side filename parsing) — unaffected by migration
- **@opensubtitles/video-metadata-extractor** — FFmpeg WASM for video metadata — unaffected

## 2. Configuration surface

### 2.1 API base URLs
Source: `src/utils/constants.js:218-224` ([constants.js](../../src/utils/constants.js))

```js
API_ENDPOINTS = {
  OPENSUBTITLES_REST:   'https://api.opensubtitles.com/api/v1',
  OPENSUBTITLES_XMLRPC: 'https://api.opensubtitles.org/xml-rpc',
  LANGUAGE_DETECTION:   'https://api.opensubtitles.com/api/v1/utilities/fasttext/language/detect/file',
  SUPPORTED_LANGUAGES:  'https://api.opensubtitles.com/api/v1/utilities/fasttext/language/supported',
  FEATURES:             'https://api.opensubtitles.com/api/v1/features',
  GUESSIT:              'https://api.opensubtitles.com/api/v1/utilities/guessit',
}
```

> [!WARNING] Hardcoded legacy URL
> `src/hooks/useMovieSearch.js:79` hits `https://www.opensubtitles.org/libs/suggest_imdb.php` directly — NOT in `API_ENDPOINTS`. This is the **autocomplete for the manual movie search box**. Must be replaced with a REST equivalent ([[02-endpoint-mapping#Movie autocomplete]]).

### 2.2 API key
- Constant: `OPENSUBTITLES_COM_API_KEY` at `src/utils/constants.js:6-11`
- Source priority:
  1. `__EMBEDDED_OPENSUBTITLES_API_KEY__` — defined by Vite at build time
  2. `import.meta.env.VITE_OPENSUBTITLES_API_KEY` — from `.env`
  3. empty string fallback
- Header name: `Api-Key` — set via `getApiHeaders()` at `constants.js:21`
- Validated at startup: `validateApiConfiguration()` at `constants.js:31`, called from `src/main.jsx:24`

### 2.3 User-Agent
- Constant: `USER_AGENT = 'OpenSubtitles Uploader PRO v1.8.9'` at `constants.js:14`
- Sent as both `User-Agent` and `X-User-Agent` headers via `getApiHeaders()` at `constants.js:21-28`
- Also embedded in every XML-RPC `LogIn` method call (anonymous and authenticated)

### 2.4 Cache keys
All in `localStorage`, defined at `constants.js:49-65`:

| Key prefix | Purpose | TTL |
|---|---|---|
| `opensubtitles_languages_cache` | Language list (REST) | No explicit TTL |
| `opensubtitles_xmlrpc_languages_cache` | Language list (XML-RPC `GetSubLanguages` filtered to upload-enabled) | No explicit TTL |
| `opensubtitles_guessit_cache` | GuessIt results, per filename | — |
| `opensubtitles_movie_guess_cache` | Movie guess, per filename | 72h (DEFAULT_SETTINGS.MOVIE_GUESS_CACHE_HOURS) |
| `opensubtitles_language_detection_cache` | FastText detection, per file MD5 | — |
| `opensubtitles_features_cache` | Features lookup, per IMDb ID | — |
| `opensubtitles_xmlrpc_checksub_cache` | CheckSubHash result, per hash list | 24h |
| `opensubtitles_debug_mode` | User pref | — |

> [!NOTE] Cache-key migration
> We'll prefix the REST-era cache keys with `rest_` (e.g. `rest_languages_cache`). First-run code will purge the legacy `opensubtitles_*` keys so nothing stale leaks into the REST path. See [[04-rest-client-refactor#Cache keys]].

## 3. Services — what they do today

### 3.1 `src/services/api/xmlrpc.js` (46 KB)

Static service class `XmlRpcService`. **All XML-RPC method calls flow through here.** Every method name + line:

| Line | Method | XML-RPC methodName | Purpose |
|---:|---|---|---|
| 28  | `anonymousLogin()`              | `LogIn('', '', 'en', UA)` | Get an anonymous session token |
| 96  | `clearAnonymousToken()`         | — | In-memory reset |
| 106 | `getAuthToken()`                | — | Pulls session via [[#5 Session detection]] |
| 126 | `parseXmlRpcResponse()`         | — | DOM XML parser |
| 141 | `extractStructData()`           | — | XML struct → JS object |
| 185 | `extractArrayData()`            | — | XML array → JS array |
| 223 | `getSubLanguages()`             | `GetSubLanguages` | Language list filtered by upload-enabled flag |
| 322 | `guessMovieFromStringUncached()`| `GuessMovieFromString` | Match filename → feature |
| 440 | `guessMovieFromString()`        | (wraps uncached, adds cache) | |
| 507 | `getUserInfo()`                 | `GetUserInfo` | User rank + upload permission |
| 566 | `searchMovies()`                | `SearchMovies` | ⚠️ **dead code — never called** |
| 620 | `guessMovieFromStringWithRetry()`| (wraps guessMovie, retries) | |
| 696 | `checkSubHashUncached()`        | `CheckSubHash` | Dedup check by hash list |
| 761 | `checkSubHash()`                | (wraps uncached, 24h cache) | |
| 828 | `tryUploadSubtitles()`          | `TryUploadSubtitles` | Pre-upload dry run |
| 1037| `uploadSubtitles()`             | `UploadSubtitles` | Actual commit |
| 1307| `xmlrpcCall()`                  | — | Generic dispatcher (used only by login/logout in `authService`) |

### 3.2 `src/services/api/openSubtitlesApi.js` (21 KB)

Static service class `OpenSubtitlesApi`. **Partial REST client — the migration already started here.** Methods:

| Line | Method | REST endpoint | Status |
|---:|---|---|---|
| 100 | `getSupportedLanguages()`       | `GET /v1/utilities/fasttext/language/supported` | ✅ working |
| 221 | `detectLanguageUncached()`      | `POST /v1/utilities/fasttext/language/detect/file` | ✅ working |
| 290 | `detectLanguage()`              | (wraps uncached, adds cache) | ✅ working |
| 380 | `getFeaturesUncached()`         | `GET /v1/features?imdb_id=X` | ✅ working |
| 410 | `getFeaturesByImdbId()`         | (wraps uncached, adds cache) | ✅ working |
| 469 | `searchFeatures()`              | `GET /v1/features?query=X` | ⚠️ **code exists, never called** |

### 3.3 `src/services/authService.js` (12 KB)

Singleton `authService`. Credential + token lifecycle.

| Line | Method | Calls | Purpose |
|---:|---|---|---|
| 23  | `login(username, hashedPwd, lang)` | `xmlrpcCall('LogIn', [...])` | Core login — expects already-hashed password |
| 146 | `loginWithHash(u, p, lang)`     | MD5s password, delegates to `.login()` | Convenience wrapper |
| 158 | `logout()`                      | `xmlrpcCall('LogOut', [token])` | Fire-and-forget |
| 195 | `checkAuthStatus(token)`        | `UserService.getUserInfo(token)` | Session re-validation |
| 241 | `getToken()`                    | — | In-memory read |
| 247 | `isLoggedIn()`                  | — | boolean |
| 257 | `isAnonymous()`                 | — | boolean |
| 274 | `restoreAuthFromStorage()`      | `localStorage.getItem(...)` | 24h-TTL rehydration |
| 310 | `clearAuthData()`               | `localStorage.removeItem(...)` + reset fields | |
| 345 | (module load)                   | `restoreAuthFromStorage()` | Auto-restores on import |

### 3.4 `src/services/userService.js` (9.7 KB)

Singleton `UserService`. User rank validation + `getUserInfo` cache.

- **1-hour in-memory cache** keyed by token string (`_userInfoCache = new Map()`) — `userService.js:24`
- `getUserInfo(token)` at line 68 → `XmlRpcService.getUserInfo()`
- `canUserUpload(userData)` at line 285 — rank gate; checks `rank !== 'UserRank'` (legacy .org's "low-trust" sentinel)
- `validateUserRank()` at line 211 — fetches rank and stamps `userData.uploadPermissionChecked`
- `clearUserInfoCache()` at line 32 — called on logout

### 3.5 `src/services/sessionManager.js` (3.5 KB)

Handles the URL-param `?sid=xxx` handoff (OAuth-style one-shot session).

- `initializeSession()` at line 13 — runs on app start, writes URL `sid` into localStorage
- `storeSessionId(sid)` at line 52 — localStorage write under key `opensubtitles_session_id`
- `getStoredSessionId()` / `clearStoredSession()` — r/w helpers

### 3.6 `src/services/subtitleUploadService.js` (50 KB)

The orchestration layer. Takes file bytes + metadata, coordinates: `tryUploadSubtitles` → `uploadSubtitles`.

Key call sites:
- Line 125: `XmlRpcService.tryUploadSubtitles(uploadData, config.uploadAsAnonymous)`
- Line 172: `XmlRpcService.uploadSubtitles(uploadData, config.uploadAsAnonymous)`

Everything else in this file is payload construction + response normalization — will mostly survive the migration with a targeted rewrite of those two lines.

### 3.7 `src/services/guessItService.js` (15 KB) + `offlineGuessItService.js` (7.6 KB)

- Online: `GET https://api.opensubtitles.com/api/v1/utilities/guessit?filename=...` via `openSubtitlesApi.js`-style pattern (but code lives in `guessItService.js`)
- Offline fallback: bundled `guessit-js` package (client-side parsing when offline)
- **Already REST, already .com** — untouched by migration

### 3.8 `src/services/cache.js` (19 KB)

Generic localStorage wrapper with expiry support. `CacheService.get/set/clear`. Consumed by xmlrpc + openSubtitlesApi caches.

## 4. Hooks — where services are consumed

| Hook | Service call | Line | Used by |
|---|---|---:|---|
| `useUserSession.js`   | `authService.getToken()`, `detectSession()` | 7–35  | Components needing session info |
| `useMovieGuess.js`    | `XmlRpcService.guessMovieFromString()`      | 307, 326 | MovieSearchOverlay, auto-guess flow |
| `useMovieSearch.js`   | Hardcoded fetch to `suggest_imdb.php`       | 79    | Manual movie search in UI |
| `useCheckSubHash.js`  | `XmlRpcService.checkSubHash()`              | ~60   | Pre-upload duplicate detection |
| `useLanguageData.js`  | `XmlRpcService.getSubLanguages()` + `OpenSubtitlesApi.getSupportedLanguages()` | 48, 71 | LanguageDropdown |
| `useLanguageDetection.js` | `OpenSubtitlesApi.detectLanguage()`      | ~30   | Auto-detect subtitle language |
| `useGuessIt.js`       | guessItService                              | —     | Filename parsing |
| `useVideoMetadata.js` | `videoMetadataService` (local FFmpeg WASM)  | —     | Client-side moviehash/bytesize |
| `useFileHandling.js`  | Local file APIs only                        | —     | Drag-drop |
| `useAppUpdate.js`     | GitHub releases API + Tauri updater plugin  | —     | Auto-update |
| `useWasmInitialization.js` | WASM loader                            | —     | FFmpeg bootstrap |
| `useCheckSubHash.js`  | `XmlRpcService.checkSubHash()`              | —     | Duplicate hash check |

## 5. Session detection

`src/utils/sessionUtils.js:82-141` — function `detectSession()`.

Priority:
1. **URL param `sid`** — `getUrlParam('sid')` — highest priority (fresh OAuth handoff)
2. **localStorage `opensubtitles_token`** — previously validated
3. **Cookie `remember_sid`** — persistent login cookie (set by .org server)
4. **Cookie `PHPSESSID`** — active session cookie (set by .org server)

Returns: `{ sessionId, source, debug }`.

Format validation: `isValidSessionFormat()` at line 169 — regex `/^[a-zA-Z0-9]{20,}$/`. **Will break for JWT** which contains dots → see [[03-auth-migration#Token format regex]].

## 6. Storage inventory

### 6.1 localStorage keys

| Key | Written by | Contains | Format |
|---|---|---|---|
| `opensubtitles_token` | authService.login(), AuthContext init | Session token string | 20+ alphanumeric |
| `opensubtitles_user_data` | authService.login(), UserService.getUserInfo() | User object | JSON |
| `opensubtitles_login_time` | authService.login() | Unix ms timestamp | string |
| `opensubtitles_remembered_username` | LoginDialog, authService.login() | Last-used username | plain string |
| `opensubtitles_session_id` | SessionManager.storeSessionId() | `sid` URL param | string |
| (cache keys from §2.4) | CacheService via xmlrpc.js / openSubtitlesApi.js | various | JSON |

### 6.2 Cookies (read-only — set by server, not the app)

- `PHPSESSID` — standard PHP session
- `remember_sid` — persistent login

### 6.3 In-memory state

- `authService.token`, `authService.userData`, `authService.isAuthenticated` — restored from localStorage at module load
- `XmlRpcService.anonymousToken` — single anon token reused across uploads
- `UserService._userInfoCache` — `Map<token, { data, cachedAt, expiresAt }>`, 1h TTL

## 7. Network utilities

- `src/utils/networkUtils.js` — `delayedFetch()` enforces a 100 ms global minimum delay between ALL outbound requests
- `src/utils/retryUtils.js` — `retryAsync()` — exponential backoff wrapper
- Network-error detection is **fragile**: multiple files check `error.name === 'TypeError' && error.message.includes('fetch')`

## 8. Components that will be touched

| Component | File | Reason |
|---|---|---|
| `LoginDialog.jsx` | `src/components/LoginDialog.jsx` | Remove MD5 hashing, call new login endpoint |
| `SubtitleUploader.jsx` | top-level uploader | Upload payload shape changes (subhash, base64 subcontent stay; feature-id resolution shifts from imdbid-only to imdbid OR tmdbid OR feature_id) |
| `UserProfile.jsx` | user profile | user data shape may differ under JWT |
| `DebugPanel.jsx` | debug overlay | Token format display |
| `ConfigOverlay.jsx` | settings | Add dual-endpoint toggle ([[10-risks-rollback]]) |
| (new) `UploadHistory.jsx` | new | `GET /api/v1/my/uploads` tab ([[06-my-uploads-integration]]) |

## 9. Dead code to delete on the way through

- `XmlRpcService.anonymousLogin()` lines 28-90 — replace with header-less requests
- `XmlRpcService.searchMovies()` line 566 — never called
- `OpenSubtitlesApi.searchFeatures()` line 469 — never called (we'll revive and actually use it, see [[02-endpoint-mapping#Movie autocomplete]])

## 10. Known hazards

> [!WARNING] MD5 password assumption
> `authService.loginWithHash()` hashes password client-side with `crypto-js/md5`. This is a **legacy .org protocol quirk** (XML-RPC LogIn expected MD5 hex). The new `/auth/login` takes plaintext over HTTPS. Remove `crypto-js` unless other code still needs MD5 (check `mkvSubtitleExtractor.js`, `subtitleHash.js`).

> [!WARNING] PHPSESSID regex
> Session-format regex `/^[a-zA-Z0-9]{20,}$/` rejects JWTs. Must change when JWT lands.

> [!WARNING] XML parsing DOMParser
> `parseXmlRpcResponse()` uses `DOMParser` — available in browser but Tauri v2 runtime too. When we remove XML-RPC, this entire code path goes. JSON-only from then on.

> [!WARNING] Client-side 24h expiry
> `authService.restoreAuthFromStorage()` enforces `now - loginTime < 24h` — this is arbitrary and independent of any server-side session lifetime. With JWT we should trust the `exp` claim instead. See [[03-auth-migration#Expiry source of truth]].

## Summary

One REST client already exists alongside the XML-RPC service — partial migration is in progress. The full swap means:

1. Merge `xmlrpc.js` + `openSubtitlesApi.js` → one unified REST client
2. Replace MD5 LogIn with JWT Bearer login
3. Rewrite the upload pipeline (`subtitleUploadService.js`) around the new `/api/v1/subtitles/upload/{check,}` endpoints
4. Add "Upload history" tab wired to `GET /api/v1/my/uploads`
5. Purge legacy cache keys on first run

See [[02-endpoint-mapping]] for the per-endpoint swap table.
