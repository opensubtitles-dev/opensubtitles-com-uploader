---
title: "10 — Risks + Rollback"
aliases: [risks, rollback, dual-endpoint]
tags: [uploader/risk, phase-2]
created: 2026-04-15
status: locked
---

# 10 — Risks + Rollback

> [!INFO] Purpose
> Known risks, mitigations, dual-endpoint transitional plan, and the actual rollback playbook if we ship v2.0 and users can't upload.

## 1. Risk register

### 1.1 Technical risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|:---:|:---:|---|
| T1 | Consumer API's login endpoint has different shape/URL than assumed in [[02-endpoint-mapping#E1]] | **H** | **H** | Confirm with Julien BEFORE starting Step 4. Q1 in [[03-auth-migration#Open questions]]. |
| T2 | JWT `exp` shorter than user's typical session → mid-upload re-login breaks flow | M | H | Implement `onAuthExpired` event that surfaces login modal + resumes upload from last payload ([[05-upload-flow]]). Test with artificially short JWT. |
| T3 | `api.opensubtitles.com` rate-limits the app's `Api-Key` → cascading 429s | M | M | Keep client-side `delayedFetch` 100ms; on 429 show clear UI + respect `retry-after`. Monitor actual 429 rate in first week. |
| T4 | `.com` features index lags `.org` by hours → guess returns no candidates for newly-added titles | L | M | Stub feature flow ([[02-endpoint-mapping#E11]]) gives users an escape hatch. |
| T5 | Multi-CD upload doesn't work — server rejects `parent_subtitle_id` passthrough | L | L (Phase 2) | Ship without multi-CD; add in Phase 5 when proven. <1% of uploads per historical data. |
| T6 | `crypto-js` removal breaks `subtitleHash.js` or `mkvSubtitleExtractor.js` | M | M | Verify before Step 11 — if still needed, keep the dep. |
| T7 | Tauri v2 `http` plugin blocks `api.opensubtitles.com` (scope config) | M | H | Update `src-tauri/tauri.conf.json` allowlist in Step 0. Test early. |
| T8 | localStorage migration runs on a user with 100k-entry cache → slow first launch | L | L | Migration only deletes a fixed list of known keys. O(1) for each. |
| T9 | JWT leaked into logs via console.log we missed | L | H | Pre-release grep for `console.log(.*token`, `console.log(.*password`. Enforce `logSensitiveData` utility. |
| T10 | Auto-updater manifest `latest.json` not updated → users stay on v1 | M | M | CLAUDE.md release sequence explicitly warns about latest.json. CI step validates it's in release assets. |

### 1.2 Product / UX risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|:---:|:---:|---|
| P1 | Users with saved `.org` credentials find login broken on first launch of v2 | **H** | M | Migrate marker resets auth; show a one-time banner: "We've switched to the new .com backend — please log in again". |
| P2 | Upload history tab users see empty list because they've only uploaded anonymously | M | L | Empty-state copy explains: "Anonymous uploads don't appear here — log in to see your history". |
| P3 | Server rank-check mismatch — `canUserUpload()` wrongly blocks legitimate users | M | H | Gate rank check behind a feature flag for first release; if false positives, disable client-side + let server be sole truth. |
| P4 | Users find the new client slow because of extra network round-trips (analyze → guess → check → commit vs old single-call) | L | M | Client-side analyze is parallel (Promise.all); guess + check can be parallelized too. Measure + optimize if needed. |
| P5 | Non-English users hit hardcoded English error copy (i18n not wired in Phase 2) | H | L | Accept. Flag i18n as top priority Phase 2 follow-up. |

### 1.3 Operational risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|:---:|:---:|---|
| O1 | `.org` XML-RPC goes down during migration → can't compare old vs new behavior | L | L | Freeze interim reference data + golden replay fixtures from prod logs now. |
| O2 | Staging environment diverges from production in a way that masks bugs | M | M | Golden replay in [[08-testing-strategy#Golden replay]] uses real prod payloads. Run same tests against production immediately post-deploy. |
| O3 | GitHub Actions workflow fails on release day → no binary for users | L | H | Local build fallback `npm run tauri:build` documented. Keep previous release binary pinned + available on releases page. |
| O4 | Secrets rotation (API key, staging JWT) breaks CI silently | L | M | CI fails loud on missing secrets. Rotate via runbook (TBD). |

## 2. Dual-endpoint transitional plan

> [!SUCCESS] Julien's design preference
> Ship a **single v2 binary** that can talk to either `.com` (default, new REST) or `.org` (legacy XML-RPC) via a user-visible toggle. This buys ~6 months of deprecation window — existing users can flip back if `.com` has a bug that blocks their flow.

### 2.1 Implementation

- **Config location:** `src/contexts/ThemeContext.jsx`-style — but a new `BackendContext.jsx` (or a section of `ConfigOverlay`).
- **State:** stored in localStorage under key `osdb_backend` — values `com` | `org`. Default: `com`.
- **REST client base URL** derived from the config:

```js
// src/services/api/restClient.js
import { getBackendPref } from '../../utils/backendPref.js';

function resolveBaseUrl() {
  return getBackendPref() === 'org'
    ? 'https://api.opensubtitles.org/xml-rpc'  // legacy path
    : 'https://api.opensubtitles.com/api/v1';  // default
}
```

- **Routing** — when backend is `org`, every call goes through the XML-RPC legacy adapters. We keep the legacy services in `src/services/api/legacy/` (not deleted in Step 11) guarded by the toggle.
- **Auth** — `com` uses JWT + plaintext; `org` uses PHPSESSID + MD5. Auth adapter picks based on backend pref.
- **UI** — toggle in `ConfigOverlay`:

```
Backend:
  ◉ opensubtitles.com (recommended — new REST API)
  ◯ opensubtitles.org (legacy — deprecated soon)
  Note: switching requires re-login.
```

- **Auth key rotation** on switch — switching backend clears the current session keys (different auth formats), forces re-login.

### 2.2 Life of the toggle

- **Month 0-1:** Default `com`. Toggle visible but unused by most users.
- **Month 2-5:** Monitor `.com` error rates + support tickets. If stable, add a deprecation warning when toggle is set to `.org`.
- **Month 6+:** Remove the toggle in a subsequent release. Delete `src/services/api/legacy/` entirely.

### 2.3 Cost

- Delays Step 11 (legacy code deletion) to Phase 2+6 months
- Adds ~200 LOC for the toggle adapter
- Doubles test surface area during transition

Julien-decision on whether to ship with or without the toggle. Default recommendation: **ship WITH toggle** — optionality + rollback safety is worth 1 extra day of work.

## 3. Rollback playbook

### 3.1 "The new build is broken for everyone"

**Symptoms:** 500+ error reports in first hour, upload failures, login failures.

**Action:**
1. GitHub release → mark v2.0.0 as **pre-release** (hides from auto-updater's "latest stable" query — but keep `latest.json` carefully).
2. Publish a `latest.json` pointing at v1.8.9 (the last pre-migration version) so existing installs that auto-update roll back.
3. Announce in #support channel (Discord/etc): "Roll back to v1 via app menu → Check for Updates, then re-install v1.8.9 from releases page."
4. Create a hotfix branch from `v1.8.9` tag for any critical .org-backend-only fixes while we regroup.
5. Debug v2 in staging; re-release when fixed.

### 3.2 "The new build is broken for a subset (e.g. users with provisional features)"

**Action:**
1. Keep v2 as current release.
2. Hotfix branch from v2.0.0 tag: `phase-2/hotfix-provisional-features`.
3. Patch + test + release v2.0.1 through standard CLAUDE.md flow.

### 3.3 "Users report login works intermittently"

**Probably:** JWT expiry too short, causing mid-session 401s.

**Action:**
1. Confirm by checking server logs for 401 rate.
2. If confirmed: raise JWT lifetime server-side OR implement refresh-token flow client-side (see Q2 in [[03-auth-migration#Open questions]]).
3. Hotfix release.

### 3.4 "`.com` backend endpoint changed its shape unexpectedly"

**Action:**
1. Check the Rails backend plan at `~/RailsProjects/osdb3/docs/plans/2026-04-14-uploader-v2-plan.md` — contract should be documented there.
2. If the Rails server broke the contract, rollback the server (it's a shared contract).
3. If the uploader is assuming a wrong shape, fix client.

## 4. Pre-release checklist

> [!IMPORTANT] Do not ship v2.0.0 until every box is ticked

- [ ] All items in [[08-testing-strategy#Manual QA checklist]] green on both macOS + Windows
- [ ] Golden replay fixtures green against staging AND production
- [ ] `grep -r 'console.log.*token\|console.log.*password'` returns zero hits
- [ ] `grep -r 'PHPSESSID\|xmlrpc\|xml-rpc\|methodCall'` returns zero hits OR only inside `src/services/api/legacy/` (if dual-endpoint toggle shipped)
- [ ] `package.json` version bumped via `npm run update-version`
- [ ] `CHANGELOG.md` regenerated
- [ ] Tauri signing key available in GitHub Actions secrets
- [ ] `latest.json` auto-generated in release artifacts (CLAUDE.md)
- [ ] Release notes cover breaking change ("we've moved to .com backend")
- [ ] Support channels briefed on the upgrade flow + toggle (if shipped)
- [ ] Rollback plan §3 rehearsed mentally with Julien

## 5. Post-release monitoring

**First 24 hours:**
- Check server-side upload_attempts table — `result='error'` rate should be flat or lower vs baseline
- Check GitHub Issues / Discord support channel — watch for repeated patterns
- Check auto-updater hit rate (latest.json requests) — expect a large spike

**First week:**
- Daily review of 429 / 401 rates server-side
- Weekly rollup of error_code distribution from upload_attempts — any code surging?

**First month:**
- Survey `backend_pref` split: how many users on `.com` vs `.org`? If `.org` is <5% we can accelerate deprecation.
- Revisit refresh-token decision based on observed 401 rate.

## 6. Coordination with Rails backend

Key cross-repo invariants that MUST hold during migration:

- **Error codes** — both repos reference [[07-error-mapping#Server-side error contract sync]]. Changes require joint commits.
- **Upload payload schema** — any new required field on server breaks old clients. Additions should be optional first, required later.
- **`/subtitles/upload/check` response shape** — `already_in_db`, `duplicate_of`, `feature`, `would_be_rejected`, `rejection_reasons`, `flags_suggested`, `quota` — all consumed by client. Don't remove/rename without client update.

Keep the Rails plan doc (`~/RailsProjects/osdb3/docs/plans/2026-04-14-uploader-v2-plan.md`) in sync with changes here.

## 7. What we explicitly accept as risk

We ship with these known limitations and accept the downstream cost:

- **No i18n for Phase 2** — English only. Accept negative DX for non-English users for 1-2 release cycles.
- **No multi-CD subtitle support** — <1% of uploads. Users who need it can use v1 via toggle. Revisit Phase 5.
- **No subtitle content preview/diff** — was not in Uploader PRO either. Not a regression.
- **No bulk upload** — one at a time. Revisit if user feedback demands.
- **No anonymous upload history** — server-side constraint. Accept.

---

## Decision register (high-stakes)

| # | Decision | Made by | Date | Notes |
|---|---|---|---|---|
| D1 | Unify `xmlrpc.js` + `openSubtitlesApi.js` into one REST client | plan | 2026-04-15 | See [[04-rest-client-refactor]] |
| D2 | New localStorage key prefix `osdb_com_*` | plan | 2026-04-15 | Zero collision with legacy |
| D3 | Anonymous uploads = omit Authorization header | plan | 2026-04-15 | Simpler than anon token cache |
| D4 | Remove MD5 password hashing | plan | 2026-04-15 | Plaintext over HTTPS is the modern norm |
| D5 | Ship dual-endpoint toggle for ~6 months | **TBD** | — | Recommendation: yes, extra safety |
| D6 | Cache key prefix `rest_*` + one-shot legacy cleanup | plan | 2026-04-15 | Prevents stale-data bleed-through |
| D7 | Phase 2 = English only | plan | 2026-04-15 | i18n in follow-up |
| D8 | Multi-CD deferred to Phase 5 | plan | 2026-04-15 | <1% use case |

Items marked **TBD** need Julien's sign-off before implementation.
