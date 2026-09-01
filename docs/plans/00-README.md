---
title: "Phase 2 — Fork & REST Migration Plans"
aliases: [uploader-rest-migration, phase-2-master, plan-index]
tags: [uploader, migration, plan-index, phase-2]
created: 2026-04-15
updated: 2026-09-01 — v2.0.0 released; env switch shipped; upstream fixes ported ([[12-upstream-drift-port]])
status: released — v2.0.0 shipped, v2.0.1 pending
---

# Phase 2 — Fork & REST Migration · Plan Index

> [!INFO] What this is
> The uploader was forked from [OpenSubtitles-Uploader-PRO](https://github.com/opensubtitles/opensubtitles-uploader-pro) to `opensubtitles-com-uploader`. It currently targets the legacy **opensubtitles.org XML-RPC** API. We're rewiring it to target the new **opensubtitles.com REST** API (shipped in the OSDB3 Rails backend, plan at `~/RailsProjects/osdb3/docs/plans/2026-04-14-uploader-v2-plan.md`).

## Reading order

1. [[01-audit-current-state]] — what's in the code today (services, hooks, contexts, constants)
2. [[02-endpoint-mapping]] — XML-RPC method → REST endpoint for every single call
3. [[03-auth-migration]] — PHPSESSID + MD5 password → JWT Bearer (the scariest swap)
4. [[04-rest-client-refactor]] — unify `xmlrpc.js` + `openSubtitlesApi.js` into one REST client
5. [[05-upload-flow]] — check / commit / replace / history, all over REST
6. [[06-my-uploads-integration]] — new "Upload history" tab using `GET /api/v1/my/uploads`
7. [[07-error-mapping]] — XML-RPC error codes → `error_code` + HTTP status from REST
8. [[08-testing-strategy]] — unit tests, plus a manual smoke test against production
9. [[09-migration-sequence]] — the actual step-by-step execution order
10. [[10-risks-rollback]] — dual-endpoint preference, what can break, how to roll back
11. [[11-stub-feature-from-imdb-tmdb]] — creating a stub feature when the title is unknown
12. [[12-upstream-drift-port]] — fixes ported from upstream v1.8.10–v1.8.21 since the fork

## Status board

| # | Document | Plan | Implementation |
|---|---|---|---|
| 01 | [[01-audit-current-state]] | ✅ written | n/a (audit doc) |
| 02 | [[02-endpoint-mapping]] | ✅ written | ✅ all endpoints migrated |
| 03 | [[03-auth-migration]] | ✅ written | ✅ shipped in step-4 commit |
| 04 | [[04-rest-client-refactor]] | ✅ written | ✅ shipped in step-1 + step-7 commits |
| 05 | [[05-upload-flow]] | ✅ written | ✅ shipped in steps 5-7 |
| 06 | [[06-my-uploads-integration]] | ✅ written | ✅ shipped in step-8 |
| 07 | [[07-error-mapping]] | ✅ written | ✅ shipped in step-10 (`ErrorBanner` + `errorCopy`) |
| 08 | [[08-testing-strategy]] | ✅ written | 🟡 unit tests landed (460 tests / 106 suites); prod smoke test blocked on Kong routes; golden replay deferred |
| 09 | [[09-migration-sequence]] | ✅ written | ✅ all 11 numbered steps committed |
| 10 | [[10-risks-rollback]] | ✅ written | n/a (advisory doc; dual-endpoint toggle not shipped) |
| 11 | [[11-stub-feature-from-imdb-tmdb]] | ✅ written | ✅ shipped (ui-steps 32-34) |
| 12 | [[12-upstream-drift-port]] | ✅ written | 🟡 4 of 6 findings ported; MKV fast path outstanding |

## Cross-repo references

- **Rails backend plan:** `~/RailsProjects/osdb3/docs/plans/2026-04-14-uploader-v2-plan.md`
- **Rails backend audit:** `~/RailsProjects/osdb3/docs/reference/uploader-v2-phase0-audit.md`
- **Rails REST endpoints landed (Phase 1):**
  - `POST /api/v1/subtitles/upload/check`
  - `POST /api/v1/subtitles/upload`
  - `POST /api/v1/subtitles/upload/guess`
  - `POST /api/v1/subtitles/upload/features/stub`
  - `GET /api/v1/my/uploads` · `PATCH /api/v1/my/uploads/:id` · `DELETE /api/v1/my/uploads/:id`

## Phase 2 exit criteria

> [!SUCCESS] Implementation complete (2026-04-16)
> All commits landed on branch `phase-2/rest-migration` (11 atomic commits):
> 1. ✅ Guess a movie — `POST /api/v1/subtitles/upload/guess` (step-5)
> 2. ✅ Check duplicate — `POST /api/v1/subtitles/upload/check` (step-6)
> 3. ✅ Upload a subtitle — `POST /api/v1/subtitles/upload` (step-7)
> 4. ✅ See it in "Upload history" — `GET /api/v1/my/uploads` (step-8)
> 5. ✅ Delete it — `DELETE /api/v1/my/uploads/:id` (step-8)
>
> Zero XML-RPC calls in source — `xmlrpc.js` deleted entirely (859 LOC removed in step-7).
> Test suite at the time: **327/327 passing** across 84 suites.
>
> Staging was dropped as a test target — it shares the prod DB, runs no sidekiq
> and has no dedicated opensearch indexes, so uploads there are never properly
> saved. See [[08-testing-strategy]] §6.
>
> Dual-endpoint toggle ([[10-risks-rollback]]) **NOT shipped** — optional follow-up if the deprecation period needs a legacy fallback.

---

## Current state (2026-09-01)

> [!SUCCESS] v2.0.0 released
> Tagged `v2.0.0` and merged to `main`. GitHub Actions built all platforms; the
> macOS `.dmg` was tested by hand and works. Test suite: **460 passing / 106
> suites**. Updater signing key generated and stored in 1Password; the public
> key is committed and the private key + password are GitHub secrets.

**Shipped since the Phase 2 plan was written:**

- **Environment switch** — runtime dev/prod toggle in the header, with per-env
  storage namespacing (infix, e.g. `osdb_com_dev_jwt`) and dual build-time API
  keys. Hidden by default: `VITE_ENV_SWITCH=false` unless explicitly enabled.
  Spec: `docs/superpowers/specs/2026-08-14-env-switch-design.md`.
- **Prod base-URL override** — `VITE_*` overrides honoured in dev/test builds
  only, so prod can be reached directly while the Kong routes are missing.
- **Upstream fixes** — four ports from upstream v1.8.10–v1.8.21, including a
  critical base64 bug that made large subtitles unuploadable. See
  [[12-upstream-drift-port]].

### Open items

| Item | State |
|---|---|
| **v2.0.1 release** | ⬜ **Warranted.** The v2.0.0 binaries still carry the base64 bug, the orphan misclassification and the silent extraction failures — all fixed on `main` but unreleased. |
| Push `39b3b5b` | ⬜ Committed locally, not yet pushed. |
| Kong routes for prod | ⬜ Blocked externally. Until they exist, prod is reachable only via the direct base-URL override. |
| Production smoke test | ⬜ Blocked on the above. Procedure in [[08-testing-strategy]] §6. |
| Env switch — browser check | ⬜ Unit-tested and built, but never opened in a browser. |
| MKV fast path | ⬜ Deliberately not ported; needs real MKV files. Rationale in [[12-upstream-drift-port]] §5. |
| `trackTitle` SDH wiring | ⬜ Predicate is tested; the component wiring is not (no React harness). |

### Known defects (tracked, not yet fixed)

- `CACHE_KEYS.XMLRPC_CHECKSUB` is referenced at `src/services/cache.js:416` and
  `:608` but is no longer defined in `constants.js` — leftover from the XML-RPC
  removal. Both sites resolve to `undefined` at runtime.
- The root `CLAUDE.md` still documents `gh workflow run "Build Desktop Apps"
  --field create_release=true`; the workflow does not accept that input.
- `npm run lint` reports 361 problems (39 errors, 322 warnings). The count has
  been steady throughout this work — nothing here introduced them — but it has
  never been triaged.

## Decision register

Decisions made during audit + planning that aren't reversible without heavy rework:

- **D1** — One unified REST client (`restClient.js`) replaces both `xmlrpc.js` and `openSubtitlesApi.js`. Fine-grained services (auth, upload, features, languages) live on top. Details in [[04-rest-client-refactor]].
- **D2** — JWT stored in `localStorage` under a NEW key `osdb_com_jwt` (no collision with legacy `opensubtitles_token`). **No refresh tokens** — JWT lives 24h, user re-logs in on expiry. Confirmed against Rails source in [[03-auth-migration#A2 Refresh tokens]].
- **D3** — Anonymous uploads preserved. Anon mode simply omits the `Authorization` header; server's `BaseController` already handles `uploader_id: nil`.
- **D4** — MD5 password hashing is **removed**. New `/auth/login` on consumer API takes plaintext over HTTPS. Removing the MD5 dependency also removes `crypto-js` unless it's needed elsewhere (check in [[04-rest-client-refactor]]).
- **D5** — Dual-endpoint preference (`.com` default, `.org` fallback) is implemented in the REST client base URL + one routing function in `authService`. Details in [[10-risks-rollback]].
- **D6** — Cache keys get prefixed `rest_*` so localStorage never serves stale XML-RPC-shaped data to the REST code. Old `opensubtitles_*` + `opensubtitles_xmlrpc_*` keys get a one-shot migration cleanup on first run.

## Tags

- #uploader/audit — [[01-audit-current-state]]
- #uploader/endpoint-mapping — [[02-endpoint-mapping]]
- #uploader/auth — [[03-auth-migration]]
- #uploader/rest-client — [[04-rest-client-refactor]]
- #uploader/upload — [[05-upload-flow]]
- #uploader/history — [[06-my-uploads-integration]]
- #uploader/errors — [[07-error-mapping]]
- #uploader/testing — [[08-testing-strategy]]
- #uploader/sequence — [[09-migration-sequence]]
- #uploader/risk — [[10-risks-rollback]]
- #uploader/stub-feature — [[11-stub-feature-from-imdb-tmdb]]
- #uploader/upstream — [[12-upstream-drift-port]]
