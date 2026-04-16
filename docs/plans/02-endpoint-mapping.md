---
title: "02 — Endpoint Mapping (XML-RPC → REST)"
aliases: [endpoint-mapping, xmlrpc-to-rest, api-mapping]
tags: [uploader/endpoint-mapping, phase-2]
created: 2026-04-15
status: locked
---

# 02 — Endpoint Mapping (XML-RPC → REST)

> [!INFO] Purpose
> Per-endpoint contract comparison: what the uploader sends today (XML-RPC), what it must send tomorrow (REST), and which request fields / response keys change. **This is the reference for the actual rewrite commits.**

## Endpoint inventory

| # | Legacy (.org XML-RPC) | New (.com REST) | File to rewrite | Plan §§ |
|---|---|---|---|---|
| E1 | `LogIn(u, md5(p), lang, UA)` | `POST /auth/login` (consumer API) | `authService.js:23` | [[03-auth-migration]] |
| E2 | `LogOut(token)` | `DELETE /auth/logout` or client-side clear | `authService.js:158` | [[03-auth-migration#Logout]] |
| E3 | `GetUserInfo(token, '1')` | `GET /infos/user` + JWT bearer | `xmlrpc.js:507`, `userService.js:68` | [[03-auth-migration#Session validation]] |
| E4 | `GetSubLanguages('en')` | `GET /infos/languages` | `xmlrpc.js:223` | §E4 below |
| E5 | `GuessMovieFromString(token, [filename])` | `POST /subtitles/upload/guess` | `xmlrpc.js:322, 440, 620` | §E5 below · [[05-upload-flow#Guess]] |
| E6 | `SearchMovies(token, query)` (dead) | `GET /features?query=X` | `openSubtitlesApi.js:469` (revive) | §E6 below |
| E7 | `suggest_imdb.php` (hardcoded legacy) | `GET /features?query=X` | `useMovieSearch.js:79` | §E6 below |
| E8 | `CheckSubHash(token, [hashes])` | `POST /subtitles/upload/check` | `xmlrpc.js:696, 761` | §E8 below |
| E9 | `TryUploadSubtitles(token, payload)` | `POST /subtitles/upload/check` (same endpoint as E8 — merged) | `xmlrpc.js:828` | §E9 below · [[05-upload-flow#Check]] |
| E10 | `UploadSubtitles(token, payload)` | `POST /subtitles/upload` | `xmlrpc.js:1037` | §E10 below · [[05-upload-flow#Commit]] |
| E11 | _(missing — gap)_ | `POST /subtitles/upload/features/stub` | new code | §E11 below |
| E12 | _(missing — gap)_ | `GET /my/uploads` | new code | [[06-my-uploads-integration]] |
| E13 | _(missing — gap)_ | `PATCH /my/uploads/:id` | new code | [[06-my-uploads-integration]] |
| E14 | _(missing — gap)_ | `DELETE /my/uploads/:id` | new code | [[06-my-uploads-integration]] |
| GH  | `GET github.com/opensubtitles/opensubtitles-uploader-pro/releases/latest` | _(unchanged, but repo URL updates to `opensubtitles/opensubtitles-com-uploader`)_ | `updateService.js` | §GH below |

> [!NOTE] REST base URL
> All new endpoints below are relative to `https://api.opensubtitles.com/api/v1/`. All require `Api-Key` header (already wired via `getApiHeaders()`). Authenticated endpoints additionally require `Authorization: Bearer <jwt>`.

---

## E1 — LogIn

### Current (XML-RPC)

```xml
POST https://api.opensubtitles.org/xml-rpc
Content-Type: text/xml

<methodCall>
  <methodName>LogIn</methodName>
  <params>
    <param><value><string>USERNAME</string></value></param>
    <param><value><string>MD5_HEX_OF_PASSWORD</string></value></param>
    <param><value><string>en</string></value></param>
    <param><value><string>OpenSubtitles Uploader PRO v1.8.9</string></value></param>
  </params>
</methodCall>
```

Response: struct with `token` (string), `status` (`"200 OK"`), `data` (user partial).

### New (REST — consumer API `/auth/login`)

> [!NOTE] Endpoint-to-confirm
> The exact URL and payload belong to the existing .com consumer API (not the uploader-v2 Rails plan). Confirm with Julien — the .com API has a documented `/login` endpoint. If the consumer API is separate from `api.opensubtitles.com/api/v1`, update this section.

Likely shape (current .com consumer API):

```http
POST https://api.opensubtitles.com/api/v1/login
Api-Key: <api_key>
Content-Type: application/json
User-Agent: OpenSubtitles Uploader v2.0.0

{
  "username": "USERNAME",
  "password": "PLAINTEXT_PASSWORD"
}
```

Response:
```json
{
  "user": {
    "allowed_downloads": 100,
    "allowed_translations": 5,
    "level": "Sub leecher",
    "user_id": 66,
    "ext_installed": false,
    "vip": false
  },
  "base_url": "https://www.opensubtitles.com",
  "token": "eyJhbGciOi...",
  "status": 200
}
```

**Client changes:**
- Drop the MD5 step (`authService.js:149`)
- JSON body, not XML
- Extract `token` as JWT (contains dots — update regex at `sessionUtils.js:175`)
- Map `user` into the local `userData` shape used by `AuthContext` — keep backwards-compatible fields (`username`, `rank`, etc.) or update consumers

See [[03-auth-migration]] for full flow.

---

## E2 — LogOut

### Current
XML-RPC `LogOut(token)` — fire-and-forget.

### New
Depends on the consumer API. Two options:
- **If** `.com` offers `DELETE /auth/logout` → call it with Bearer, then clear localStorage.
- **If not** → client-side clear is sufficient for JWT (stateless by design).

**Decision:** default to **client-side clear only**, unless Julien confirms a server-side logout endpoint exists. Documented in [[03-auth-migration#Logout]].

---

## E3 — GetUserInfo

### Current (XML-RPC)
`xmlrpc.js:507` — `GetUserInfo(token, '1')`. Returns full user rank, download count, etc.

### New (REST)

```http
GET https://api.opensubtitles.com/api/v1/infos/user
Api-Key: <api_key>
Authorization: Bearer <jwt>
```

Response (approximate — confirm on staging):
```json
{
  "data": {
    "allowed_downloads": 100,
    "level": "Sub leecher",
    "user_id": 66,
    "username": "...",
    "vip": false,
    "ext_installed": false,
    "downloads_count": 42,
    "remaining_downloads": 58
  }
}
```

**Client changes:**
- `UserService.getUserInfo(token)` at `userService.js:68` → rewrite to call REST
- Cache key: stay keyed by token (a JWT is long but unique per session)
- 1-hour cache TTL unchanged
- 401 handling: clear auth (same as current)

**Rank-check gap:** `canUserUpload()` currently looks at `rank !== 'UserRank'` (legacy `UserRank` = new user, can't upload). The REST response uses `level` instead of `rank`. Map the check accordingly (`level === 'Sub leecher'` → new account; allow or reject per server's upload permission).

---

## E4 — GetSubLanguages

### Current (XML-RPC)
```
GetSubLanguages('en')
```
Filters to only upload-enabled languages (legacy server-side flag). Cached under `XMLRPC_LANGUAGES`.

### New (REST)
```http
GET https://api.opensubtitles.com/api/v1/infos/languages
Api-Key: <api_key>
```

Response:
```json
{
  "data": [
    { "language_code": "eng", "language_name": "English" },
    ...
  ]
}
```

**Gap:** the REST endpoint doesn't filter by `upload_enabled`. Two options:
1. **Backend change** — add `?upload_enabled=true` query param server-side
2. **Client change** — fetch all + hide non-upload-enabled in UI (current UI already does this)

**Decision:** ship client-side first (no backend change needed), add server-side filter as a follow-up. Existing REST client method `getSupportedLanguages()` at `openSubtitlesApi.js:100` **already hits this endpoint** — we just need the hook `useLanguageData.js` to stop also calling XML-RPC.

**`useLanguageData.js` cleanup:**
- Delete the XML-RPC branch (line 48-ish) that calls `XmlRpcService.getSubLanguages()`
- Keep only `OpenSubtitlesApi.getSupportedLanguages()`
- Drop the merge logic + `LanguageDataSingleton` hack — single source of truth now

---

## E5 — GuessMovieFromString

### Current (XML-RPC)
`GuessMovieFromString(token, [filename])`. Returns array of candidate movies. Cached 72h.

### New (REST — server-side endpoint already shipped, see Rails plan §6)

```http
POST https://api.opensubtitles.com/api/v1/subtitles/upload/guess
Api-Key: <api_key>
Authorization: Bearer <jwt>   # optional — works for anon too
Content-Type: application/json

{ "filename": "Dune.2021.720p.BluRay.x264.srt", "moviehash": "56eae6bbfd721b0f" }
```

Response:
```json
{
  "best_guess": { "feature_id": 42, "imdbid": 411008, "tmdbid": 1815, "title": "Dune", "year": 2021, "type": "movie", "score": 0.97 },
  "candidates": [ ... ]
}
```

**Client changes:**
- `XmlRpcService.guessMovieFromString()` at `xmlrpc.js:322/440/620` → new `guessMovie(filename, moviehash?)` on unified REST client
- Cache key stays per-filename; TTL unchanged (72h)
- Retry wrapper (`guessMovieFromStringWithRetry` at line 620) ports over unchanged — same `retryAsync` utility

**Bonus win:** REST response includes `tmdbid` (XML-RPC didn't). `useMovieGuess.js` can prefer `feature_id` (most stable) → IMDb → TMDb when constructing the upload payload.

---

## E6 — Movie search (autocomplete)

### Current
Two call sites, both legacy:
- `XmlRpcService.searchMovies()` at `xmlrpc.js:566` — **dead**
- `useMovieSearch.js:79` — hardcoded `GET https://www.opensubtitles.org/libs/suggest_imdb.php?m_mo=<query>`

### New (REST)
```http
GET https://api.opensubtitles.com/api/v1/features?query=<url-encoded>
Api-Key: <api_key>
```

Response: array of `{ feature_id, imdbid, tmdbid, title, year, type }` matching the query.

**Client changes:**
- Delete dead code at `xmlrpc.js:566` (the `searchMovies` method)
- Rewrite `useMovieSearch.js:79-88` to call `OpenSubtitlesApi.searchFeatures()` (line 469 — currently dead but correct shape)
- Revive `searchFeatures()` by calling it from the hook

---

## E7 — legacy suggest_imdb.php
Covered by E6. Single hardcoded URL gets replaced.

---

## E8 — CheckSubHash (dedup)

### Current (XML-RPC)
`CheckSubHash(token, [hash1, hash2, ...])`. Returns `{ hash1: existing_subtitle_id_or_0, hash2: ... }`. Cached 24h.

### New (REST — merged into `/subtitles/upload/check`)

The new `/check` endpoint does dedup + filename-spam + language-dup + quota check all in one. For pre-upload dedup the uploader can either:

**Option A (recommended):** include `subhash` in the `/check` call — the single endpoint covers both dedup and upload feasibility. Drop the separate `checkSubHash` flow.

**Option B (if dedup check needs to happen BEFORE a full `/check`):** add a lightweight `GET /subtitles/by-subhash/:hash` endpoint server-side.

**Decision:** **Option A.** The uploader already composes the full metadata payload before dedup (because `subhash = md5(rawContent)` is computed client-side once the file is read). Single round-trip = better UX. `useCheckSubHash.js` shrinks to a thin wrapper around `uploadCheck()`.

### Effective request shape

```http
POST https://api.opensubtitles.com/api/v1/subtitles/upload/check
Api-Key: <api_key>
Authorization: Bearer <jwt>   # optional
Content-Type: application/json

{
  "subhash":       "md5-hex",
  "subfilename":   "Dune.2021.srt",
  "moviehash":     "56eae6bbfd721b0f",
  "moviebytesize": 1200000000,
  "idmovieimdb":   "411008",
  "movietimems":   9360000,
  "moviefps":      23.976,
  "movieframes":   224640,
  "sublanguageid": "eng"
}
```

Response (see server §6.2):
```json
{
  "already_in_db": false,
  "duplicate_of": null,
  "feature": { "feature_id": 42, "imdbid": 411008, "title": "Dune", "year": 2021 },
  "would_be_rejected": false,
  "rejection_reasons": [],
  "flags_suggested": { "hearing_impaired": false, "high_definition": true, "foreign_parts_only": false },
  "quota": { "limit": 50, "remaining": 49, "resets_at": "..." }
}
```

**Client changes:**
- Drop `xmlrpc.js:696, 761, 828` (checkSubHash + tryUploadSubtitles)
- Add `uploadCheck(payload)` on unified REST client
- `useCheckSubHash.js` + `subtitleUploadService.js` both consume `uploadCheck`
- Cache `already_in_db` + `duplicate_of` per subhash — 24h TTL preserved

---

## E9 — TryUploadSubtitles

### Current
Dry-run upload. Returns `alreadyindb: 0|1`, `subtitles` array (dup summary).

### New
**Already merged into E8.** `TryUploadSubtitles` + `CheckSubHash` collapse into one REST endpoint `/subtitles/upload/check`.

---

## E10 — UploadSubtitles (commit)

### Current (XML-RPC)
50 KB `subtitleUploadService.js` + `buildUploadSubtitlesXml` at `xmlrpc.js:1118` constructs an enormous XML struct:

```xml
<struct>
  <member><name>baseinfo</name>...</member>
  <member><name>cd1</name>
    <struct>
      <member><name>subhash</name>...</member>
      <member><name>subfilename</name>...</member>
      <member><name>subcontent</name><base64>...</base64></member>
      <member><name>moviehash</name>...</member>
      <member><name>moviebytesize</name>...</member>
      <member><name>moviefps</name>...</member>
      <member><name>movieframes</name>...</member>
      <member><name>movietimems</name>...</member>
    </struct>
  </member>
  <!-- cd2, cd3 if multi-CD -->
</struct>
```

### New (REST — server-side landed in Phase 1)

```http
POST https://api.opensubtitles.com/api/v1/subtitles/upload
Api-Key: <api_key>
Authorization: Bearer <jwt>   # optional — anonymous works too
Content-Type: application/json

{
  "subhash":       "md5-hex",
  "subfilename":   "Dune.2021.srt",
  "subcontent":    "<base64 of gzipped subtitle bytes>",
  "moviehash":     "56eae6bbfd721b0f",
  "moviebytesize": 1200000000,
  "idmovieimdb":   "411008",
  "movietimems":   9360000,
  "moviefps":      23.976,
  "movieframes":   224640,
  "sublanguageid": "eng",
  "release_name":  "Dune.2021.720p.BluRay.x264",
  "movie_aka":     "",
  "translator":    "",
  "author_comments": "",
  "hearing_impaired":  false,
  "high_definition":   true,
  "foreign_parts_only": false,
  "machine_translated": false,
  "guessit":        { /* client guessit output */ },
  "video_metadata": { "bitrate": 5000000, "codec": "h264" }
}
```

Response:
```json
{
  "subtitle_id":  1234,
  "feature_id":   42,
  "subfile_id":   5678,
  "download_url": "https://www.opensubtitles.com/subtitles/...",
  "status":       "created",
  "flags_applied": ["high_definition"],
  "warnings":     [],
  "quota":        { "limit": 50, "remaining": 48, "resets_at": "..." }
}
```

**Client changes:**
- Rewrite `subtitleUploadService.js` around JSON payload — most of the file is metadata-collection logic that survives; the XML construction at `xmlrpc.js:1118-1291` is deleted wholesale
- Multi-CD support — legacy `.org` bundled cd1+cd2+cd3 in a single call. The new REST API takes **one subtitle per request**. Multi-CD uploads become N sequential POSTs (the server auto-links via `parent_subtitle_id` if we pass it, or client groups them into a "series" on `/my/uploads`)

> [!NOTE] Multi-CD in Phase 2
> Decision deferred — current users who upload multi-CD splits are <1% per Julien's historical data. We can either:
> 1. Ship Phase 2 with one-file-at-a-time — user clicks upload N times
> 2. Have the client loop through CDs sequentially and link them
>
> Recommend **option 1** to ship faster; revisit in Phase 5 if user feedback demands it.

- `uploadAsAnonymous` flag stays — just translates to "omit Authorization header"
- Base64+gzip encoding of `subcontent` stays unchanged

---

## E11 — Stub feature creation (new)

**Gap:** legacy uploader had no "movie not in IMDb" fallback. New pipeline exposes:

```http
POST https://api.opensubtitles.com/api/v1/subtitles/upload/features/stub
Api-Key: <api_key>
Authorization: Bearer <jwt>   # required
Content-Type: application/json

{ "title": "My Unknown Movie", "year": 2024, "type": "movie" }
```

Response:
```json
{ "feature_id": 9001, "provisional": true, "title": "My Unknown Movie", "type": "Movie", "year": 2024,
  "message": "Provisional feature created. A moderator will review it shortly." }
```

**Client changes:**
- New `createStubFeature(title, year, type)` on unified REST client
- New UI: "Movie not found in our database? Create provisional entry" button when `guess` returns no candidates
- Component: extend `MovieSearchOverlay` with a "Create new" fallback CTA

---

## E12 / E13 / E14 — /my/uploads CRUD
See [[06-my-uploads-integration]] for full UI + hook design. The three endpoints:

| Endpoint | Method | Params | Returns |
|---|---|---|---|
| `/my/uploads` | `GET` | `?page=1&per_page=20&language_code=eng&enabled=true` | `{ data: [...], meta: { total_count, page, per_page, total_pages } }` |
| `/my/uploads/:id` | `PATCH` | `release_name, movie_aka, author_comments, hearing_impaired, hd, foreign_parts_only, machine_translated` | `{ subtitle_id, status: "updated", subtitle: {...} }` |
| `/my/uploads/:id` | `DELETE` | — | `{ subtitle_id, status: "deleted" }` (soft-delete: `enabled=false`) |

All require Bearer JWT. Anonymous users cannot see history (since anon uploads have `uploader_id: nil`).

---

## GH — GitHub releases (unchanged)

- Current URL: `https://api.github.com/repos/opensubtitles/opensubtitles-uploader-pro/releases/latest`
- New URL: `https://api.github.com/repos/opensubtitles/opensubtitles-com-uploader/releases/latest` — **update repo slug after fork is renamed**
- `src/services/updateService.js` is the only file that hits github.com

---

## Checklist — per-endpoint migration tasks

For each row in [[#Endpoint inventory]], these are the concrete TODOs. Links to per-step plans in [[09-migration-sequence]].

- [ ] E1 — `POST /login` request shape + response parsing (JWT extract, user mapping)
- [ ] E2 — decide logout endpoint or client-clear
- [ ] E3 — `GET /infos/user` + field map (rank→level)
- [ ] E4 — `GET /infos/languages` wiring into `useLanguageData.js`, delete XML-RPC branch
- [ ] E5 — `POST /subtitles/upload/guess` + `useMovieGuess.js` + retry ported
- [ ] E6 — `GET /features?query=X` + revive `searchFeatures()` + rewrite `useMovieSearch.js`
- [ ] E7 — delete hardcoded `suggest_imdb.php` URL
- [ ] E8+E9 — `POST /subtitles/upload/check` (merged dedup + pre-check)
- [ ] E10 — `POST /subtitles/upload` (JSON payload, delete `buildUploadSubtitlesXml`)
- [ ] E11 — `POST /subtitles/upload/features/stub` + UI CTA
- [ ] E12 — `GET /my/uploads` + UI tab
- [ ] E13 — `PATCH /my/uploads/:id`
- [ ] E14 — `DELETE /my/uploads/:id`
- [ ] GH — update repo URL after rename

See [[09-migration-sequence]] for the recommended order and grouping.
