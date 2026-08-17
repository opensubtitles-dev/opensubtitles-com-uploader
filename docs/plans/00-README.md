---
title: "Phase 2 — Fork & REST Migration Plans"
aliases: [uploader-rest-migration, phase-2-master, plan-index]
tags: [uploader, migration, plan-index, phase-2]
created: 2026-04-15
updated: 2026-04-16 — Phase 2 implementation landed (commits 1-10 on branch phase-2/rest-migration)
status: implementation-complete
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
| 08 | [[08-testing-strategy]] | ✅ written | 🟡 unit tests landed (416 tests); prod smoke test blocked on Kong routes; golden replay deferred |
| 09 | [[09-migration-sequence]] | ✅ written | ✅ all 11 numbered steps committed |
| 10 | [[10-risks-rollback]] | ✅ written | n/a (advisory doc; dual-endpoint toggle not shipped) |

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
> Test suite: **327/327 passing** across 84 suites.
>
> **Pending**: manual production smoke test via the environment switch (blocked on
> Kong routes), then version bump + GH Actions release per CLAUDE.md sequence.
> Staging was dropped as a test target — it shares the prod DB, runs no sidekiq
> and has no dedicated opensearch indexes, so uploads there are never properly
> saved. See [[08-testing-strategy]] §6.
>
> Dual-endpoint toggle ([[10-risks-rollback]]) **NOT shipped** — optional follow-up if the deprecation period needs a legacy fallback.

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
