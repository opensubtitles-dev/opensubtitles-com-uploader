---
title: 'Runtime environment switch (dev/ngrok ↔ prod)'
date: 2026-08-14
status: approved-design
supersedes: staging-based smoke test in docs/plans/08-testing-strategy.md §6
---

# Runtime environment switch — design

## 1. Problem

The uploader picks its backend at build time. `VITE_OPENSUBTITLES_BASE_URL`
is read once in `src/utils/constants.js:46`, and every entry of
`API_ENDPOINTS` (`constants.js:266-275`) is a template string baked from it
at module load. Changing backend means editing `.env` and rebuilding.

Two needs make that insufficient:

1. **Remote testers.** The dev backend is exposed through a stable ngrok
   subdomain (`https://osdev.ngrok.dev/api/v1`). People elsewhere should be
   able to run a build against it without a toolchain, and switch to
   production to compare.
2. **The smoke test has to happen in production.** See §7.

## 2. Goals / non-goals

**Goals**

- A switch at the top of the uploader window flips between `dev` and `prod`.
- Every API call — REST client, language detection, guessit, features —
  follows the selected environment. No call may reach the other backend.
- Each environment carries its own API key.
- Sessions and cached API data never cross between environments.
- The public release is hard-wired to production and shows no switch.

**Non-goals**

- Arbitrary user-entered URLs. The registry is closed: `dev` and `prod`.
- Staging as a selectable environment. It is being removed, not added (§7).
- Live backend swapping without a reload (explicitly rejected, §4).
- Preserving in-flight work (dropped files, detections) across a flip.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Switch ships only in dev/test builds; public build is prod-only | Public users must never be able to select a backend that lives on a laptop behind ngrok |
| D2 | Per-environment namespacing of session + caches | Makes cross-contamination structurally impossible, rather than something every future switch path must remember to clean up |
| D3 | Two build-time API keys (`_PROD`, `_DEV`) | Key travels with the environment definition, so selecting an env selects its key. Kong rejects unknown consumers in prod |
| D4 | Persist choice, then reload the window | Module-level constants stay valid; no refactor of `API_ENDPOINTS` or `RestClient`. A partial live swap could silently leave one service on the old backend |
| D5 | Embedding the prod key in the tester build is accepted | Same exposure the public release already carries; confirmed acceptable by the project owner. The tester build is shared by link, not posted publicly |
| D6 | Unscoped auth/cache keys are purged once, not migrated | There is no reliable way to know which backend an existing unscoped token came from. Guessing risks presenting a dev session as a prod one. Cost is a single re-login |

## 4. Architecture

### 4.1 Environment registry — `src/config/environments.js` (new)

Single source of truth. Pure except for `localStorage` access and the reload.

```js
export const ENVIRONMENTS = {
  prod: {
    id: 'prod',
    label: 'Production',
    baseUrl: 'https://api.opensubtitles.com/api/v1',
    apiKey: PROD_KEY,
  },
  dev: {
    id: 'dev',
    label: 'Dev (ngrok)',
    baseUrl: normalizeBaseUrl(DEV_BASE_URL),
    apiKey: DEV_KEY,
  },
};

export const SWITCH_ENABLED;                 // build flag, see §4.4
export function listSelectableEnvironments();
export function getActiveEnvironmentId();
export function getActiveEnvironment();
export function setActiveEnvironment(id, { reload } = {});
```

**The gating invariant.** When `SWITCH_ENABLED` is false,
`getActiveEnvironmentId()` returns `'prod'` unconditionally and ignores any
stored value. A public build cannot be dragged onto the dev backend by a
leftover `osdb_backend` entry — for example on a machine where a tester
build was previously installed. This is the single most important rule in
the module and gets a dedicated test.

`setActiveEnvironment` takes an injectable `reload` function so it can be
tested without a browser.

**Default on first run.** With nothing stored, a build whose switch is
enabled starts on `dev`, and any other build starts on `prod`. A tester
build exists precisely to exercise the dev backend, and this preserves what
today's `.env` already does; the public build has no `dev` to fall back to.
Once a choice is stored it always wins, subject to the gating invariant
above.

### 4.2 Constants — `src/utils/constants.js` (modified)

Keeps its present shape. Only the two resolutions change:

```js
export const OPENSUBTITLES_BASE_URL = getActiveEnvironment().baseUrl;
export const OPENSUBTITLES_COM_API_KEY = getActiveEnvironment().apiKey;
```

Everything downstream — `API_ENDPOINTS`, `RestClient`'s `this.baseUrl` /
`this.apiKey` capture (`restClient.js:88-89`), `getApiHeaders` — is
unchanged. This is the payoff of D4.

`validateApiConfiguration()` is extended to name which environment's key is
missing, and to log the active environment id alongside the base URL.

### 4.3 Storage scoping — `src/utils/storageKeys.js` (modified)

New helper:

```js
export const scopedKey = (baseKey, envId) => `${baseKey}:${envId}`;
```

`STORAGE_KEYS` and `CACHE_PREFIXES` keep their exact current string values,
so the existing assertions in `tests/utils/storageKeys.test.js` continue to
pass unchanged.

**Scoped** (suffixed with the active env id at every read and write):

- `STORAGE_KEYS.JWT`, `.USER`, `.LOGIN_TIME`
- All seven `CACHE_PREFIXES` entries

**Not scoped:**

- `BACKEND_PREF` — it *is* the selector; must be global
- `MIGRATION_V2_DONE`, `MIGRATION_V3_DONE` (new) — migration markers
- `REMEMBERED_USERNAME` — cosmetic, environment-independent

**One-shot purge (D6).** A `MIGRATION_V3_DONE` marker guards a single pass
that deletes the unscoped `osdb_com_jwt`, `osdb_com_user`,
`osdb_com_login_time` and any unscoped `rest_*` cache entries left by
pre-2.0.0 builds. Users re-log in once. This reuses the existing
`migrateLegacyKeys()` shape in `storageKeys.js`.

### 4.4 Build wiring — `scripts/embed-api-keys.js`, `vite.config.js`

Mirrors the existing embedding pattern (`constants.js:6-11`): a compile-time
global with an `import.meta.env` fallback.

| Global | Env var | Meaning |
|---|---|---|
| `__EMBEDDED_OPENSUBTITLES_API_KEY_PROD__` | `VITE_OPENSUBTITLES_API_KEY_PROD` | Production consumer key |
| `__EMBEDDED_OPENSUBTITLES_API_KEY_DEV__` | `VITE_OPENSUBTITLES_API_KEY_DEV` | Dev backend key |
| `__ENV_SWITCH_ENABLED__` | `VITE_ENV_SWITCH` | `'true'` enables the switch |

Backwards compatibility: the legacy `VITE_OPENSUBTITLES_API_KEY` is accepted
as a fallback for the **dev** key only, with a one-line console warning.
That matches what the variable currently holds in the working `.env`. It is
deliberately *not* a fallback for the prod key — a silently wrong key
against prod Kong is worse than a clear startup error.

Two build profiles:

- **Tester build** — `VITE_ENV_SWITCH=true`, both keys embedded.
- **Public build** — flag unset, only `_PROD` embedded. `ENVIRONMENTS.dev`
  has no `baseUrl` and is not selectable; the switch does not render.

### 4.5 UI — `src/components/EnvironmentSwitch.jsx` (new)

Returns `null` when `SWITCH_ENABLED` is false, so the public build carries
no dead chrome. Rendered in the header block at
`SubtitleUploader.jsx:2436`. (There is no separate `Header` component;
`SubtitleUploader.jsx` is ~2450 lines and renders its own header inline.)

DaisyUI control showing the active environment. `dev` renders as a warning
badge so a tester can never be unsure which backend is receiving uploads.
Selecting the already-active environment is a no-op — no reload.

## 5. Data flow on flip

1. Tester selects **Production**.
2. `setActiveEnvironment('prod')` writes `osdb_backend = 'prod'`.
3. `window.location.reload()`.
4. On boot `environments.js` resolves `prod`; `constants.js` derives the base
   URL and key; `API_ENDPOINTS` and every `RestClient` are built from them.
5. Auth reads `osdb_com_jwt:prod` — absent, so the tester is logged out *on
   prod only* and logs in there.
6. Caches read and write `rest_*:prod`. Dev-cached `/guess` and `/features`
   entries are invisible.

Flipping back restores the dev session and its caches untouched.

## 6. Error handling

| Case | Behavior |
|---|---|
| Stored env id absent | Use the first-run default (§4.1): `dev` when the switch is enabled, otherwise `prod` |
| Stored env id unknown or unselectable | Fall back to the first-run default, rewrite storage |
| `SWITCH_ENABLED` false | Always `prod`; stored value ignored |
| Dev base URL not configured in this build | `dev` omitted from `listSelectableEnvironments()`; cannot be selected |
| Key missing for the active environment | `validateApiConfiguration()` fails and names the environment |
| Dev backend unreachable (ngrok tunnel down) | Normal network-error path; the existing `ErrorBanner` and `errorCopy` mapping already cover this. No special case |

## 7. Why the smoke test moves to production

`docs/plans/08-testing-strategy.md` §6 specifies integration tests against
`https://staging.opensubtitles.com/api/v1`. That plan is not viable:

- Staging runs against the **production database**.
- Staging does **not run sidekiq**, so asynchronous post-upload processing
  never happens.
- Staging has **no dedicated opensearch indexes**.

An upload performed on staging is therefore not properly saved or indexed.
The test would appear to pass while exercising less than it claims, and it
writes into the prod DB anyway — the risk of prod without the fidelity.

Production is the honest target. It is acceptable because uploads are
traceable and reversible: the project owner can identify subtitles by source
and date. The uploader adds a second, independent handle — `USER_AGENT` is
`OpenSubtitles Uploader PRO v2.0.0` (`constants.js:53`), and no other build
emits `v2.0.0`, so every test upload is identifiable by user-agent alone.

**Backend prerequisite:** the API is already deployed in production; the
remaining step is creating the **Kong routes**. The smoke test is blocked
until those exist.

### Documents to rewrite

| File | Change |
|---|---|
| `docs/plans/08-testing-strategy.md` | §6 replaced with the prod procedure; drop `tests/integration/staging.test.js`, the `STAGING_TEST=1` harness, `STAGING_TEST_JWT`, and the `staging-smoke` CI job (lines 180-232, 286-331, 361-363) |
| `docs/plans/00-README.md` | Status board row 08 (line 39) and the exit-criteria "Pending" callout (line 67) |
| `docs/plans/05-upload-flow.md` | Line 330: "set backend to staging" → use the environment switch |
| `docs/plans/06-my-uploads-integration.md` | Line 249: staging smoke checkbox → prod smoke |

## 8. Testing

Unit tests only. No test may perform a network call.

**`tests/config/environments.test.js`** (new)

- Empty storage, switch enabled → `dev` (first-run default)
- Empty storage, switch disabled → `prod`
- Stored `dev` with switch enabled → `dev`
- **Stored `dev` with switch disabled → `prod`** (the D1 gating invariant)
- Unknown stored id → first-run default, storage rewritten
- `dev` omitted from selectable list when its base URL is unconfigured
- `setActiveEnvironment` persists and calls the injected `reload`
- Selecting the active environment does not reload

**`tests/utils/storageKeys.test.js`** (extended)

- `scopedKey` composition
- Existing `STORAGE_KEYS` / `CACHE_PREFIXES` assertions unchanged
- V3 purge removes unscoped auth + cache keys, is idempotent, leaves scoped
  and non-scoped-by-design keys alone

**`tests/utils/constants.test.js`** (extended)

- Base URL and API key follow the active environment

Manual verification remains the prod smoke test, once Kong routes exist.

## 9. Documentation deliverables

- **`.env.example`** — replace the single key with `_PROD` / `_DEV`, document
  `VITE_ENV_SWITCH`, drop staging from the example overrides.
- **`README.md`** — full rewrite. Currently brands as "PRO" and documents the
  pre-2.0 single-backend setup. New content: prerequisites, install, env
  configuration, running against ngrok vs prod, using the switch, building a
  tester build vs the public build, running `npm test`, and the prod
  smoke-test procedure.

## 10. Acceptance criteria

- [ ] Tester build shows the switch; public build does not render it
- [ ] A stored `dev` preference is ignored by a build with the switch disabled
- [ ] Flipping environments reloads, and every subsequent API call —
      REST, language detection, guessit, features — targets the selected base
      URL with that environment's key
- [ ] Logging in on prod leaves the dev session intact, and vice versa
- [ ] A `/guess` result cached on dev never renders while prod is active
- [ ] Pre-2.0.0 unscoped auth and cache keys are purged exactly once
- [ ] `npm test` green, including the gating-invariant test
- [ ] Plan docs contain no remaining staging-smoke instructions
- [ ] `.env.example` and `README.md` describe the two-environment setup
