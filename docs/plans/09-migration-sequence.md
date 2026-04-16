---
title: "09 — Migration Sequence"
aliases: [migration-sequence, execution-order, step-by-step]
tags: [uploader/sequence, phase-2]
created: 2026-04-15
status: locked
---

# 09 — Migration Sequence

> [!INFO] Purpose
> The actual step-by-step execution order. Each step is an atomic commit with tests. Ordered so that main branch is green and usable (against staging) after every step.

## Principles

1. **One endpoint per commit** — easy to bisect
2. **Old + new live side-by-side** until the last commit deletes the XML-RPC path
3. **Every commit is releasable** — if we stop mid-sequence, the app still works (some features may use old XML-RPC, others new REST, but never broken)
4. **Staging smoke test after every commit** — per [[08-testing-strategy#Manual QA]]
5. **No version bumps mid-sequence** — single version bump at the end when shipping as v2.0.0

## Sequence

### Step 0 — Pre-flight

- [ ] **0.1** — Read all plans end-to-end. Raise any disagreements before starting.
- [x] **0.2** — ~~Confirm open questions in [[03-auth-migration#Open questions]] (Q1-Q8) with Julien.~~ **All resolved against Rails source** — see [[03-auth-migration#12 Confirmed answers]].
- [ ] **0.3** — Create feature branch: `git checkout -b phase-2/rest-migration`
- [ ] **0.4** — Set up dev env: `npm install`, copy `.env.example` → `.env`, set `VITE_OPENSUBTITLES_API_KEY`.
- [ ] **0.5** — Verify `npm run tauri:dev` builds and the app launches.
- [ ] **0.6** — Snapshot baseline: manually confirm current legacy flow works against `.org` (login, upload, etc). This is our "did we regress vs baseline" reference.

### Step 1 — Plumbing (no behavior change)

**Goal:** Land the new REST client infrastructure alongside the legacy code. Nothing calls it yet.

- [ ] **1.1** — Add dev dependencies: `msw`, `@testing-library/react`, `@testing-library/dom`, `happy-dom`.
- [ ] **1.2** — Create `src/services/api/authStore.js` ([[04-rest-client-refactor#Why authStore is a module]]).
- [ ] **1.3** — Create `src/services/api/restClient.js` with `RestClient`, `RestError`, `AuthError`.
- [ ] **1.4** — Add `STORAGE_KEYS` constant module (`src/utils/storageKeys.js`) with `JWT`, `USER`, `LOGIN_TIME` + legacy key list for migration.
- [ ] **1.5** — Unit tests for `restClient.js` per [[08-testing-strategy#Unit tests REST client]].
- [ ] **1.6** — Commit: `feat: add unified REST client (no behavior change)`

### Step 2 — Languages endpoint (easy win, low blast radius)

**Goal:** Prove the new client works end-to-end with one of the simplest endpoints.

- [ ] **2.1** — Create `src/services/api/languages.js` (`languagesApi.list()`).
- [ ] **2.2** — Rewire `src/hooks/useLanguageData.js` to call `languagesApi.list()`; delete the XML-RPC `getSubLanguages` branch + `LanguageDataSingleton`.
- [ ] **2.3** — Verify language dropdown still populates in dev.
- [ ] **2.4** — Delete `XmlRpcService.getSubLanguages()` (`xmlrpc.js:223`).
- [ ] **2.5** — Cache migration: delete `opensubtitles_xmlrpc_languages_cache*` keys on first run (if not already in migrator).
- [ ] **2.6** — Commit: `feat: migrate languages endpoint to REST client`

### Step 3 — Features search (autocomplete) + delete hardcoded .org URL

**Goal:** Kill the only hardcoded legacy URL + revive the dead REST `searchFeatures`.

- [ ] **3.1** — Create `src/services/api/features.js` (`searchByQuery`, `byImdbId`).
- [ ] **3.2** — Rewire `src/hooks/useMovieSearch.js:79-88` to use `featuresApi.searchByQuery()`.
- [ ] **3.3** — Delete the hardcoded `suggest_imdb.php` URL.
- [ ] **3.4** — Delete `XmlRpcService.searchMovies()` (dead code).
- [ ] **3.5** — Delete `OpenSubtitlesApi.searchFeatures()` from the partial REST client; features logic now lives solely in `features.js`.
- [ ] **3.6** — Verify movie autocomplete works in dev.
- [ ] **3.7** — Commit: `feat: migrate movie autocomplete to REST + remove legacy .org URL`

### Step 4 — Auth flow (the big one) ⚠️

**Goal:** Swap PHPSESSID + MD5 → JWT + plaintext login. Highest risk step.

> [!WARNING] Do this on a Monday morning
> This step breaks login against `.org`. Make sure [[03-auth-migration#Open questions]] are all answered before starting. The step is only safe when the `.com` consumer API's login + user-info endpoints are confirmed working with your API key.

- [ ] **4.1** — Create `src/services/api/auth.js` (`login`, `logout`, `getUserInfo`).
- [ ] **4.2** — Rewrite `src/services/authService.js`:
  - [ ] Remove `CryptoJS` import + `loginWithHash`
  - [ ] Rewrite `login()` to call `authApi.login()`
  - [ ] Rewrite `checkAuthStatus()` to call `authApi.getUserInfo()`
  - [ ] Rewrite `restoreAuthFromStorage()` → `hydrateFromStorage()` with new key names
  - [ ] Add `migrateLegacyKeys()` one-shot migrator
  - [ ] Wire `authStore.setToken()` on every state change
- [ ] **4.3** — Rewrite `src/services/userService.js` — `getUserInfo` now calls `authApi.getUserInfo()`.
- [ ] **4.4** — Update `src/contexts/AuthContext.jsx`:
  - [ ] `login(username, password)` drops the second hash step
  - [ ] `refreshAuth()` removed (or no-ops — triggers event-driven re-login)
  - [ ] Init calls `hydrateFromStorage()` + `authApi.getUserInfo()` validation
- [ ] **4.5** — Update `src/utils/sessionUtils.js`:
  - [ ] Rename `detectSession` → `detectJwt` (delete cookie reads)
  - [ ] Update `isValidSessionFormat` regex to JWT shape
  - [ ] URL param handoff: `?jwt=` (or whatever Julien decides in Q7)
- [ ] **4.6** — Update `src/components/LoginDialog.jsx` — no MD5 step, pass plaintext.
- [ ] **4.7** — Delete `src/services/sessionManager.js` (merged into authService).
- [ ] **4.8** — Unit tests — state machine coverage per [[08-testing-strategy#Unit tests auth state machine]].
- [ ] **4.9** — Manual staging test: login + restart + logout.
- [ ] **4.10** — Commit: `feat: swap PHPSESSID+MD5 auth for JWT Bearer`

### Step 5 — Movie guess

- [ ] **5.1** — Add `uploadApi.guess()` method to `src/services/api/upload.js` (may need to create file stub now).
- [ ] **5.2** — Rewire `src/hooks/useMovieGuess.js` (lines 307, 326) to call `uploadApi.guess()`.
- [ ] **5.3** — Port 72h cache key prefix from `opensubtitles_movie_guess_cache` → `rest_movie_guess_cache`.
- [ ] **5.4** — Port `guessMovieFromStringWithRetry` wrapper (keeps the retry semantics).
- [ ] **5.5** — Delete `XmlRpcService.guessMovieFromString*` (lines 281-660).
- [ ] **5.6** — Verify auto-guess on file drop works.
- [ ] **5.7** — Commit: `feat: migrate movie guess to REST /subtitles/upload/guess`

### Step 6 — Pre-upload check (merged CheckSubHash + TryUploadSubtitles)

- [ ] **6.1** — Add `uploadApi.check()` method.
- [ ] **6.2** — Collapse `src/hooks/useCheckSubHash.js` to call `uploadApi.check()` with the full payload — returns `already_in_db` + `duplicate_of` among other fields.
- [ ] **6.3** — Refactor `src/services/subtitleUploadService.js`:
  - [ ] Extract a `buildCheckPayload(payload)` helper that strips `subcontent`
  - [ ] Replace `tryUploadSubtitles` call with `uploadApi.check()`
- [ ] **6.4** — Port 24h cache key prefix.
- [ ] **6.5** — Delete `XmlRpcService.checkSubHash*` + `tryUploadSubtitles` + `buildCheckSubHashXml` + `buildTryUploadXml`.
- [ ] **6.6** — Commit: `feat: merge CheckSubHash+TryUpload into REST /subtitles/upload/check`

### Step 7 — Upload commit

- [ ] **7.1** — Add `uploadApi.commit()` method.
- [ ] **7.2** — Major rewrite of `src/services/subtitleUploadService.js`:
  - [ ] Replace XML construction with JSON payload builder
  - [ ] Call `uploadApi.commit()` instead of `uploadSubtitles`
  - [ ] Response shape changes: `subtitle_id`, `subfile_id`, `download_url`, `status`, `flags_applied`, `warnings`, `quota`
  - [ ] Update all callers in `SubtitleUploader.jsx` that read response fields
- [ ] **7.3** — Delete `XmlRpcService.uploadSubtitles` + `buildUploadSubtitlesXml` + `escapeXmlContent`.
- [ ] **7.4** — Multi-CD: implement sequential upload with `parent_subtitle_id` ([[05-upload-flow#Multi-CD in Phase 2]]).
- [ ] **7.5** — Manual test: full round-trip on staging — log in, drop file, commit, verify on server.
- [ ] **7.6** — Commit: `feat: migrate upload commit to REST /subtitles/upload`

### Step 8 — Upload history tab

- [ ] **8.1** — Add `src/services/api/myUploads.js` per [[04-rest-client-refactor]].
- [ ] **8.2** — Create `src/hooks/useMyUploads.js`.
- [ ] **8.3** — Create components per [[06-my-uploads-integration]]:
  - [ ] `UploadHistory.jsx`
  - [ ] `UploadHistoryList.jsx`
  - [ ] `UploadHistoryItem.jsx`
  - [ ] `UploadEditDialog.jsx`
  - [ ] `UploadDeleteConfirm.jsx`
  - [ ] `UploadHistoryFilters.jsx`
- [ ] **8.4** — Add `/history` route in React Router.
- [ ] **8.5** — Add tab navigation in main layout.
- [ ] **8.6** — Error + empty + loading states.
- [ ] **8.7** — Manual test: upload → appears in history → edit → reload → edit persists → delete → disappears.
- [ ] **8.8** — Commit: `feat: add upload history tab`

### Step 9 — Stub feature creation

- [ ] **9.1** — Add `uploadApi.createStubFeature()` method.
- [ ] **9.2** — Extend `MovieSearchOverlay` with "Movie not in database? Create new entry" CTA visible when guess returns no candidates.
- [ ] **9.3** — Form: title, year, type (radio: movie / tvshow / episode).
- [ ] **9.4** — On submit: call `createStubFeature()`, seed `payload.feature_id` with the returned id, advance to upload.
- [ ] **9.5** — Commit: `feat: add provisional feature creation flow`

### Step 10 — Error handling polish

- [ ] **10.1** — Create `src/components/ErrorBanner.jsx` per [[07-error-mapping#UI error components]].
- [ ] **10.2** — Wire into every phase of `useUpload`.
- [ ] **10.3** — Wire into `useMyUploads`, `useMovieGuess`, auth flow.
- [ ] **10.4** — Unit test coverage per [[07-error-mapping#Checklist]].
- [ ] **10.5** — Commit: `feat: unified error banner + error-code routing`

### Step 11 — Delete legacy code

- [ ] **11.1** — Delete `src/services/api/xmlrpc.js` (if not already fully gutted by prior steps).
- [ ] **11.2** — Delete `src/services/api/openSubtitlesApi.js` (content already migrated to `features.js`, `languages.js`, `languageDetection.js`).
- [ ] **11.3** — Remove `crypto-js` from `package.json` — **only if** `src/services/subtitleHash.js` doesn't need MD5 for the subhash computation. Verify first.
- [ ] **11.4** — Grep for `xmlrpc`, `xml-rpc`, `XML-RPC`, `PHPSESSID`, `methodCall` across whole codebase. Any remaining references get deleted or flagged.
- [ ] **11.5** — Commit: `chore: delete legacy XML-RPC paths`

### Step 12 — Cosmetics + release

- [ ] **12.1** — Update README with new backend info.
- [ ] **12.2** — Update `CHANGELOG.md` with v2.0.0 notes (breaking — .org backend removed).
- [ ] **12.3** — Update `package.json` repo URL, description, etc.
- [ ] **12.4** — Update all user-agent strings to `OpenSubtitles Uploader v2.0.0`.
- [ ] **12.5** — Follow `CLAUDE.md` release sequence:
  - [ ] `npm run update-version` (bumps to 2.0.0)
  - [ ] `npm run generate-changelog`
  - [ ] Commit + tag `v2.0.0`
  - [ ] `gh workflow run "Build Desktop Apps" --field create_release=true`
- [ ] **12.6** — Final staging smoke + golden replay green.

## Dual-endpoint preference (optional parallel workstream)

See [[10-risks-rollback#Dual-endpoint toggle]]. If we ship a dual-endpoint transitional build, the toggle lives in `ConfigOverlay` and gates the `baseUrl` of the REST client. The legacy XML-RPC path lives behind the toggle's `.org` branch.

This can be inserted between Step 11 and Step 12 without disrupting other steps. It adds ~1 day of work.

## Per-step commit template

```
feat(phase-2/step-N): <one-line summary>

<body>
- What changed
- What survives
- What's deleted
- Tests added

Staging smoke: passed on YYYY-MM-DD by <name>
```

## Timing estimate

Rough — assumes one developer (Julien or delegated), 4h focused blocks:

| Step | Effort | Risk |
|---|---|---|
| 0 — Pre-flight | 0.5d | low |
| 1 — Plumbing | 1d | low |
| 2 — Languages | 0.5d | low |
| 3 — Features search | 0.5d | low |
| 4 — Auth swap | 2d | **HIGH** (unknowns in consumer API) |
| 5 — Movie guess | 0.5d | low |
| 6 — Pre-upload check | 1d | med |
| 7 — Upload commit | 1.5d | med-high (50KB service rewrite) |
| 8 — History tab | 1.5d | low (new feature) |
| 9 — Stub feature | 0.5d | low |
| 10 — Error polish | 1d | low |
| 11 — Delete legacy | 0.5d | low |
| 12 — Release | 0.5d | low |
| **Total** | **~11d focused** | |

Realistic wall-clock: 2-3 weeks including review + staging feedback loops.

## Rollback anchors

After each step: `git tag phase-2/step-<N>-done` so any later step can `git revert` cleanly back to a known-good state. See [[10-risks-rollback]] for full rollback playbook.
