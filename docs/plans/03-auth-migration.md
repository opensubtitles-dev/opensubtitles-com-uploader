---
title: "03 — Auth Migration (PHPSESSID → JWT)"
aliases: [auth-migration, jwt-migration, login-migration]
tags: [uploader/auth, phase-2, security]
created: 2026-04-15
updated: 2026-04-15 — open questions resolved against Rails source
status: locked
---

# 03 — Auth Migration (PHPSESSID → JWT)

> [!INFO] Purpose
> Detailed plan for swapping the legacy `.org` XML-RPC `LogIn` → PHPSESSID flow with JWT Bearer on the `.com` consumer API. This is the highest-risk change in Phase 2 — it touches auth state machine, session persistence, cookie handling, and every API call's header.

> [!SUCCESS] Open questions resolved
> All open questions confirmed against the Rails source at `~/RailsProjects/osdb3/`. Endpoint contracts, JWT lifetime, level names, and refresh-token strategy all locked. See [[#12 Confirmed answers]].

## 1. Target state (what we want)

```
┌──────────────────────────────────────────────┐
│  JWT Bearer auth against .com consumer API   │
│                                              │
│  login:   POST /api/v1/login                 │
│           → body { username, password }      │
│           → returns { token, user, status }  │
│                                              │
│  state:   localStorage['osdb_com_jwt']       │
│           (new key — no collision w/ legacy) │
│                                              │
│  every  : Authorization: Bearer <jwt>        │
│  request  Api-Key: <apikey>                  │
│           (current header — unchanged)       │
│                                              │
│  logout:  client-side clear (JWT is stateless)│
│           OR DELETE /api/v1/logout if exposed │
│                                              │
│  check :  GET /api/v1/infos/user on restart  │
│           401 → clear, show login            │
└──────────────────────────────────────────────┘
```

## 2. What stays, what changes

| Area | Stays | Changes |
|---|---|---|
| `AuthContext.jsx` public API | `login`, `logout`, `user`, `token`, `isAuthenticated`, `loading`, `error` | Internals: no MD5 hash; `refreshAuth` rethought |
| `LoginDialog.jsx` | Form fields, validation, "remember username" | Remove `MD5` import; payload becomes plaintext password |
| localStorage | Remembered username key | Auth keys rotated — see §5 below |
| Cookies | — | Stop reading `PHPSESSID` / `remember_sid` — legacy fallback removed |
| Session detection priority | — | URL `?jwt=` → localStorage JWT → nothing. Drop cookies entirely. |
| Header shape | `Api-Key`, `User-Agent`, `X-User-Agent` | Add `Authorization: Bearer <jwt>` to authenticated calls |
| `XmlRpcService.getAuthToken()` | — | Deleted when XML-RPC goes — replaced by a helper on the unified REST client |
| Anon upload | Allowed | Simpler: no anon token dance — just omit `Authorization` header |

## 3. State machine (target)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         APP START                                    │
│                            │                                         │
│           ┌────────────────┴────────────────┐                       │
│           │ JWT in URL (?jwt=...)?          │                       │
│           │     ↓ yes                       │                       │
│           │  strip + store in localStorage   │                       │
│           │     ↓                            │                       │
│           └──────────────┬───────────────────┘                      │
│                          │                                          │
│           ┌──────────────▼───────────────────┐                     │
│           │ JWT in localStorage?              │                     │
│           │    yes → hydrate authService     │                     │
│           │    no  → stay logged out         │                     │
│           └──────────────┬───────────────────┘                     │
│                          │                                          │
│           ┌──────────────▼───────────────────┐                     │
│           │ verify: GET /infos/user w/ Bearer │                     │
│           │   200 → setIsAuthenticated(true)  │                     │
│           │   401 → clear, show LoginDialog   │                     │
│           │   network err → stay offline-ok  │                     │
│           └───────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       LOGIN FLOW                                     │
│                                                                      │
│   user enters creds → LoginDialog.handleSubmit()                    │
│       ↓                                                              │
│   authService.login(u, p, lang) — NO MD5                            │
│       ↓                                                              │
│   POST /api/v1/login                                                │
│       ↓                                                              │
│   ┌────────────────────┐  ┌─────────────────────┐                  │
│   │ 200 → extract .token│  │ 401 → throw "bad   │                  │
│   │      + .user        │  │        creds"     │                  │
│   │      store JWT      │  │ 429 → throw "rate  │                  │
│   │      setState       │  │        limited"   │                  │
│   │      fetch /infos/user│  └─────────────────────┘                │
│   │      (enhanced)      │                                          │
│   └────────────────────┘                                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       LOGOUT FLOW                                    │
│                                                                      │
│   context.logout()                                                  │
│       ↓                                                              │
│   (optional) DELETE /api/v1/logout — best-effort                    │
│       ↓                                                              │
│   localStorage.removeItem(JWT + user + login_time)                  │
│       ↓                                                              │
│   UserService.clearUserInfoCache()                                  │
│       ↓                                                              │
│   AuthContext setState → logged out                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 4. File-by-file change list

### 4.1 `src/services/authService.js`

Before:
```js
async login(username, hashedPassword, lang = 'en') {
  const params = [username, hashedPassword, lang, this.userAgent];
  const response = await xmlrpcCall('LogIn', params);
  if (response.status.includes('200')) {
    this.token = response.token;
    // ... localStorage writes ...
  }
}

async loginWithHash(username, password, lang) {
  const hashedPassword = CryptoJS.MD5(password).toString();
  return this.login(username, hashedPassword, lang);
}
```

After:
```js
async login(username, password, lang = 'en') {
  const response = await restClient.post('/login', {
    username,
    password,   // PLAINTEXT over HTTPS — no MD5
  });
  if (response.status === 200 && response.token) {
    this.token = response.token;
    this.userData = response.user;
    this.isAuthenticated = true;
    storage.set(STORAGE_KEYS.JWT, response.token);
    storage.set(STORAGE_KEYS.USER, JSON.stringify(response.user));
    storage.set(STORAGE_KEYS.LOGIN_TIME, Date.now().toString());
    // fetch enhanced user info (rank validation)
    try {
      const enhanced = await userService.getUserInfo(response.token);
      if (enhanced) {
        this.userData = { ...response.user, ...enhanced };
        storage.set(STORAGE_KEYS.USER, JSON.stringify(this.userData));
      }
    } catch (_) { /* graceful degradation */ }
    return { success: true, token: response.token, userData: this.userData };
  }
  throw new Error(response.message || 'Login failed');
}
```

**Deleted:**
- `loginWithHash()` (no MD5)
- All `CryptoJS` imports

**Renamed:**
- `restoreAuthFromStorage()` → `hydrateFromStorage()` (same logic, new key names)

### 4.2 `src/contexts/AuthContext.jsx`

- `login(username, password, lang)` — drop the double-hop (was: `authService.loginWithHash` → `authService.login`). Direct call only.
- Init flow — use `detectJwt()` instead of `detectSession()`. If JWT exists, call `restClient.get('/infos/user')` to validate.
- `refreshAuth()` — today it re-logs-in (impossible without plaintext creds). With JWT the right move is: rely on server 401 to force re-login. Remove or make it a no-op that triggers navigation back to LoginDialog.

### 4.3 `src/utils/sessionUtils.js`

- `detectSession()` (lines 82-141) — delete cookie reads (`PHPSESSID`, `remember_sid`). Rename to `detectJwt()`.
- `isValidSessionFormat()` (line 169) — regex change:

  ```js
  // Before
  const sessionPattern = /^[a-zA-Z0-9]{20,}$/;
  // After (JWT: base64url segments joined by dots)
  const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  ```

- URL param: switch from `sid` → `jwt` (or accept both during transition). Discuss in [[#Open questions]].

### 4.4 `src/services/sessionManager.js`

- Currently stores URL `sid` → localStorage `opensubtitles_session_id`
- Becomes: stores URL `jwt` → localStorage `osdb_com_jwt` (new key)
- Or **delete entirely** if we merge this concern into `authService.hydrateFromStorage()`. Preference: delete. One fewer service.

### 4.5 `src/services/userService.js`

- `getUserInfo(token)` at line 68 → `restClient.get('/infos/user')` with Bearer header from `token`
- 1-hour cache keyed by JWT string — unchanged
- `canUserUpload()` — update rank logic:
  ```js
  // Before: rank !== 'UserRank'
  // After:  level !== 'Sub leecher' (or whatever the .com equivalent is)
  ```
  Confirm with Julien on the exact level name for "new account / limited upload" — see [[#Open questions]].

### 4.6 `src/services/api/xmlrpc.js`

- **Delete entirely** once REST migration is complete. Intermediate steps in [[09-migration-sequence]].

### 4.7 `src/components/LoginDialog.jsx`

- Remove MD5 import + hashing call (line 54)
- Payload change — `login(username, password, 'en')` instead of `login(...hashed...)`
- Error display — no change (still reads `AuthContext.error`)

### 4.8 `src/components/DebugPanel.jsx`

- `authService.getToken().substring(0, 8)` — still works; JWTs are longer than 8 chars. Just displays the header segment.
- Optional: decode + display JWT payload's `exp`, `iat` claims for debug visibility.

### 4.9 `src/utils/securityUtils.js`

- No changes — `logSensitiveData` + `hideSensitiveData` work for any token format.
- **Usage:** ensure every log line that currently mentions `PHPSESSID` or `SessionID` is updated to say `JWT`.

## 5. Storage key rotation

### 5.1 New keys (tag: `osdb_com_*` to disambiguate from legacy)

| Key | Purpose |
|---|---|
| `osdb_com_jwt` | JWT Bearer token |
| `osdb_com_user` | User object (JSON) |
| `osdb_com_login_time` | Unix ms of last login |
| `osdb_com_remembered_username` | (pre-existing `opensubtitles_remembered_username` kept as-is — cosmetic) |

### 5.2 One-shot migration on first run

```js
// src/services/authService.js — on module load, before hydrate
function migrateLegacyKeys() {
  const LEGACY = [
    'opensubtitles_token',
    'opensubtitles_user_data',
    'opensubtitles_login_time',
    'opensubtitles_session_id',
    // cache keys that held XML-RPC-shaped data:
    'opensubtitles_xmlrpc_languages_cache',
    'opensubtitles_xmlrpc_languages_cache_expiry',
    'opensubtitles_xmlrpc_checksub_cache',
    'opensubtitles_xmlrpc_checksub_cache_expiry',
    'opensubtitles_movie_guess_cache',
    'opensubtitles_movie_guess_cache_expiry',
  ];
  const MARKER = 'osdb_migration_v2_done';
  if (storage.get(MARKER)) return;
  LEGACY.forEach(k => storage.remove(k));
  storage.set(MARKER, '1');
  console.log('✅ Migrated legacy localStorage keys to REST shape');
}
```

This runs once on first launch of the new version, then the marker prevents re-runs. No user-visible effect beyond forcing re-login (which is necessary anyway — old PHPSESSID tokens don't work against `.com`).

## 6. Expiry source of truth

### 6.1 Current
Hardcoded `24h` client-side (`authService.js:285`) — has nothing to do with server's real session lifetime. If the PHPSESSID happens to be valid longer, we still nuke it after 24h; if it expires sooner, we'll get 401 on the next call and clear then.

### 6.2 Target
**Rely on server 401.** The JWT's `exp` claim is the source of truth but we don't need to parse it client-side:

- On every response, 401 triggers `clearAuthData()` + show LoginDialog
- No client-side timer, no age check
- `login_time` kept only for debug/UI ("signed in 3 days ago")

### 6.3 Optional refresh-token TBD

If the .com consumer API supports refresh tokens:
```
POST /api/v1/refresh
Authorization: Bearer <refresh_token>
→ { token: <new_access_jwt> }
```

Plan: wrap every fetch in a retry that, on 401, attempts one refresh before giving up. **TBD — Julien to confirm whether `.com` already issues refresh tokens.** If not, we ship Phase 2 without them and user just re-logs-in on expiry.

## 7. Anonymous uploads

### Current
`XmlRpcService.anonymousLogin()` → XML-RPC `LogIn('', '', ...)` → stores `anonymousToken` in memory → upload calls pass it as the token param.

### Target
**Delete anonymous login entirely.** Anon mode = no `Authorization` header. Server's `BaseController#resolve_upload_user!` already treats missing/empty bearer as anon. No pre-auth round-trip needed.

```js
// Client code (unified REST client)
async post(path, body, { authenticated = 'auto' } = {}) {
  const headers = { ...getApiHeaders(), ...(authenticated !== false && this.jwt ? { Authorization: `Bearer ${this.jwt}` } : {}) };
  // ...
}

// Upload call (anon mode)
restClient.post('/subtitles/upload', payload, { authenticated: false });
```

This is simpler + removes a class of 401-cascade bugs (anon token expired, upload fails, retry needs fresh anon login).

## 8. 401 handling

Global wrapper in the unified REST client:

```js
async request(path, opts) {
  const response = await fetch(this.base + path, this.buildFetchOpts(opts));
  if (response.status === 401 && opts.authenticated !== false) {
    this.onAuthExpired();   // clears auth + dispatches event for UI
    throw new AuthError('Session expired, please log in again');
  }
  // ...
}
```

`onAuthExpired()` in `authService`:
```js
onAuthExpired() {
  this.clearAuthData();
  window.dispatchEvent(new CustomEvent('osdb:auth-expired'));
}
```

Components listen for the event + show the LoginDialog modal. Matches current UX.

## 9. Security review

### Current risks (being fixed)
- MD5 password hashing: marginal value; mostly cosmetic over HTTPS. Removing it **does not weaken** security — it's already over TLS.
- PHPSESSID in cookie fallback: cross-site contamination risk when sharing Chrome profiles. JWT-only removes this surface.
- localStorage cleartext: same risk with JWT as with PHPSESSID — any script running on the page (XSS, devtools, extensions) can read it. Tauri desktop has no extensions, and the app has no third-party scripts, so risk is limited.

### New assumptions
- **HTTPS enforced** — the REST base URL is `https://api.opensubtitles.com/...` and we won't support http://. Tauri's `http` plugin respects the scheme. Add allowlist in `src-tauri/tauri.conf.json` to disallow http scheme for api.opensubtitles.com.
- **No credential logging** — existing `logSensitiveData()` utility is the enforced path. Grep for any `console.log(.*password)` / `console.log(.*token.*substring)` before shipping.
- **CSRF not applicable** — REST API uses `Api-Key` + `Authorization` headers (no cookies for state), so CSRF is irrelevant.

## 10. Test plan

See [[08-testing-strategy#Auth tests]] for unit + integration test specifics. Minimum coverage:

- [ ] Login with correct creds → 200 → JWT stored, user populated, `isAuthenticated=true`
- [ ] Login with wrong creds → 401 → error shown, localStorage untouched
- [ ] Login with rate-limited → 429 → error shown
- [ ] App restart with valid JWT → `GET /infos/user` 200 → hydrated
- [ ] App restart with expired JWT → 401 → cleared, LoginDialog shown
- [ ] `osdb:auth-expired` event fires on 401 during an upload mid-session
- [ ] Legacy key migration runs exactly once per install
- [ ] Anonymous upload works without ever touching auth
- [ ] Logout clears all JWT state + user cache

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Consumer API rate-limits login attempts | Preserve current backoff (`retryUtils`). Surface rate-limit errors clearly in UI. |
| R2 | `refreshAuth()` no longer meaningful (can't re-auth without plaintext) | Replace with event-driven "please log in again" flow |
| R3 | Users with PHPSESSID cookies from old app get confused state | Migration code deletes all legacy keys; users are simply logged out once and sign in fresh |
| R4 | JWT contains PII that shouldn't be logged | `logSensitiveData` already hides it — enforce with lint rule or pre-commit check |
| R5 | `/infos/user` endpoint unavailable → users can't log in | Cached last-known user data allows offline-ok startup; actual login still requires server |

## 12. Confirmed answers

> [!SUCCESS] All resolved against Rails source on 2026-04-15
> Source files: `app/controllers/api/v1/sessions_controller.rb`, `app/controllers/api/v1/sessions/current_jwt_controller.rb`, `app/models/user.rb`, `app/lib/kong_utils_faraday.rb`.

### A1 — Login endpoint

```http
POST https://api.opensubtitles.com/api/v1/login
Api-Key: <consumer_api_key>
Content-Type: application/json
User-Agent: <your_ua>

{ "username": "alice", "password": "plaintext_over_https" }
```

**Plaintext password** — no MD5. `sessions_controller.rb:64-67` uses `user.valid_password?(login_params[:password])` which is Devise bcrypt internally.

Success response (200):
```json
{
  "user": {
    "allowed_translations": 5,
    "allowed_downloads":    20,
    "level":                "Sub leecher",
    "user_id":              66,
    "ext_installed":        false,
    "vip":                  false
  },
  "token":    "eyJhbGciOi...",
  "status":   200,
  "base_url": "https://www.opensubtitles.com"
}
```

Failure response (401):
```json
{
  "message": "Error, invalid username/password failed:<n> remaining:<m> ...",
  "status":  401
}
```

> [!WARNING] Devise lockout + rate-limit behavior
> The server tracks `failed_attempts` per user (Devise `Lockable`) and also caches a Redis key `api_login-<username>-<password>` to prevent the same cred pair being re-tried within 24h. Repeated bad-cred spam will eventually 401 with "this password was already tried in the past 24 hours". Surface these messages verbatim to the user — they're informative.

### A2 — Refresh tokens

**Desktop flow (our Phase 2/3 scope):** No refresh tokens. JWT lives 24h, user re-logs in after expiry.

**Web SPA flow (future Phase 4):** Works differently — a logged-in Devise session at `.com` can mint a fresh JWT via `GET /api/v1/sessions/current_jwt` (returns `{ token, expires_at, api_key }`). This is specifically for the embedded React uploader in Rails. **Not applicable to the desktop app.**

Plan for desktop: trust 24h JWT, handle 401 gracefully via `onAuthExpired` event → show LoginDialog.

### A3 — Logout endpoint

```http
DELETE https://api.opensubtitles.com/api/v1/logout
Api-Key: <api_key>
Authorization: Bearer <jwt>
```

Success (200): `{ "message": "token successfully destroyed", "status": 200 }`
Already-invalid (401): `{ "message": "token was already invalid", "status": 401 }`

Server behavior: `KongUtilsFaraday.delete_all_jwt(uid)` revokes **all** JWTs for this user across all clients. Also clears the Redis `get_token_<user_id>` cache so the next login mints fresh.

**Client behavior:** call logout endpoint best-effort (wrap in try/catch), then clear local storage regardless. Any network error during logout is benign — the client-side clear still happens.

### A4 — JWT lifetime

**24 hours.** Confirmed at `kong_utils_faraday.rb:437`:
```ruby
exp = (Time.now + 24.hours).to_i
```

Kong enforces this server-side. Client doesn't need to parse `exp` — just honor 401s when they come.

### A5 — Anonymous consumers

**Simply omit `Authorization` header.** The `Api-Key` header is always required (that's the Consumer auth via Kong), but the JWT/Bearer is optional. Absent or invalid JWT = `@current_user` is `nil` server-side → anonymous upload.

No special "anonymous API key" needed. The same consumer API key works for both auth'd and anon calls.

See `api_controller.rb:77-114`: JWT resolution only happens when `http_token.blank? == false`. Empty/missing token just means `@current_user = nil`.

### A6 — User level / rank mapping

Canonical list from `user.rb:271-279`:

| Category | Values |
|---|---|
| Admin | `SuperAdministrator`, `Administrator` |
| VIP | `VIP Member`, `VIP+ Member`, `VIP++ Member`, `VIP Lifetime`, `OpenSubtitles Legends` |
| Privileged | `translator`, `Trusted Member`, `Application Developers` |
| Standard | `Sub leecher` (default/new account), `Bronze Member`, `Silver Member`, `Gold Member`, `Platinum Member` |

The `level` field in the login response is the user's **primary rank** (from `get_rank`). Legacy `.org` used `rank: "UserRank"` for new-low-trust accounts; `.com` uses `level: "Sub leecher"`.

**Upload permissions are enforced server-side by the anti-abuse pipeline** — quota, bans, spam patterns (see Rails plan §10). Client-side `canUserUpload()` gating is **deleted** in the migration. Let the server decide; surface any `403 banned` / `403 anon_duplicate_language` etc. via the error banner.

### A7 — URL param for JWT handoff

**Desktop app (this repo):** N/A — user logs in via LoginDialog, no URL handoff.

**Web SPA (Phase 4, different repo context):** the embedded React uploader inside Rails uses the Devise session cookie + `GET /api/v1/sessions/current_jwt` endpoint to obtain a JWT. No URL param needed.

Result: `sessionManager.js` and all `?sid=` URL-param logic can be **deleted**. Nothing replaces it.

### A8 — Dual-endpoint toggle behavior

Legacy XML-RPC auth is completely incompatible with the new flow (different protocol, different credential format). If the user toggles to `.org` in the Settings, the full legacy auth path + legacy XML-RPC services must be active for that session.

**Decision:** if we ship the toggle, keep a `legacy/` directory with the original XML-RPC stack + the MD5-password login. Switch between the two via the `BackendContext` at the REST-client base level. Already documented in [[10-risks-rollback#Dual-endpoint toggle]].

Recommendation: ship the toggle for the first 3–6 months of v2, then delete `legacy/` in a follow-up release.

---

## 13. Concrete implementation snippets

### 13.1 Login

```js
// src/services/api/auth.js
import { restClient } from './restClient.js';

export const authApi = {
  async login({ username, password }) {
    // POST /login — no Authorization header required (only Api-Key)
    return restClient.post('/login', { username, password }, { authenticated: false });
  },

  async logout() {
    // DELETE /logout — swallow errors; client-clear is the source of truth
    try {
      return await restClient.delete('/logout');
    } catch (e) {
      if (e.status === 401) return { message: 'already invalid', status: 401 };
      console.warn('Logout call failed (benign):', e);
      return null;
    }
  },

  async getUserInfo() {
    // GET /infos/user — requires Bearer
    return restClient.get('/infos/user');
  },
};
```

### 13.2 User mapping

```js
// src/services/authService.js — after receiving login response
const { user, token, base_url } = response;

this.token = token;
this.userData = {
  userId:              user.user_id,
  username:            username,                 // echoed from request
  level:               user.level,               // e.g. "Sub leecher"
  vip:                 user.vip,
  allowedDownloads:    user.allowed_downloads,
  allowedTranslations: user.allowed_translations,
  extInstalled:        user.ext_installed,
  baseUrl:             base_url,                 // "https://www.opensubtitles.com"
};
this.isAuthenticated = true;
```

### 13.3 Anonymous upload

```js
// No auth — just omit Authorization
await uploadApi.check(payload, { anonymous: true });
await uploadApi.commit(payload, { anonymous: true });
```

The `restClient.buildHeaders({ authenticated: false })` skips the `Authorization` header. Api-Key still sent.

### 13.4 Login lockout UX

When login returns `message` containing "failed:" or "remaining:", surface verbatim — it's a warning that tells the user how many attempts they have left.

```js
try {
  await authApi.login({ username, password });
} catch (e) {
  if (e.status === 401 && e.details?.message) {
    setError(e.details.message);   // "Error, invalid password — 3 remaining before lockout"
  } else {
    setError(e.message);
  }
}
```
