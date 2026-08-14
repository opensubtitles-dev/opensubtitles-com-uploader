# Runtime Environment Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a dev/test build flip between the ngrok dev backend and production at runtime, with sessions and caches fully isolated per environment, while the public build stays hard-wired to production.

**Architecture:** A new `src/config/environments.js` owns the environment registry, the active-environment resolution and the build-time gate. `constants.js` derives its base URL and API key from it. All localStorage key names get the environment id baked in as an infix, computed once at module load by pure builder functions, so no call site has to remember to scope anything. Switching persists the choice and reloads the window, which keeps every existing module-level constant valid.

**Tech Stack:** React 18, Vite 5, Tauri v2, `node:test` + `node:assert/strict` (run via `npm test` → `node --test "tests/**/*.test.js"`), Prettier, DaisyUI 4 + lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-14-env-switch-design.md`

## Global Constraints

- Test runner is `node --test`. **Never** use vitest/jest syntax — no `describe.each`, no `vi.mock`, no `expect`. Use `import { test, describe } from 'node:test'` and `import assert from 'node:assert/strict'`.
- No test may perform a network call.
- ESM only (`"type": "module"`). Use `import`, never `require`.
- Prettier must pass: `npx prettier --check <files>`. Run `npx prettier --write` before committing.
- Never log an API key, JWT, or session id. Use `logSensitiveData()` from `src/utils/securityUtils.js` (project CLAUDE.md, Security Guidelines).
- Do **not** run `npm run build` — it chains `generate-changelog`, which now queries this fork's empty release feed and would blank `CHANGELOG.md`. Use `npx vite build` to verify a build.
- Environment ids are exactly `'prod'` and `'dev'`. No other value is ever valid.
- Key scoping is an **infix** immediately after the namespace token: `osdb_com_` → `osdb_com_dev_`, `rest_` → `rest_dev_`, `opensubtitles_` → `opensubtitles_dev_`. This preserves both the existing `/^osdb_com_/` and `/^rest_/` prefix assertions and the `endsWith('_expiry')` checks in `cache.js`.

---

## Deviations from the spec (read before starting)

Two things were found while planning that the spec gets wrong. This plan is correct; the spec will be amended to match.

1. **Scoping happens inside the key modules, not at call sites.** Spec §4.3 proposes a `scopedKey(base, envId)` helper applied at every read and write. There are 16 such call sites across `sessionUtils.js`, `sessionManager.js`, `authService.js`, `features.js` and `languages.js`, plus ten prefix-scanning loops in `cache.js` that derive keys from `Object.values(CACHE_KEYS)`. Applying a helper at each one is exactly the "every future path must remember" failure that decision D2 exists to prevent. Instead, `STORAGE_KEYS`, `CACHE_PREFIXES` and `CACHE_KEYS` export values that are **already scoped**, built once at module load. Every consumer becomes correct with zero changes.

2. **There is a second cache-key system the spec missed.** `CACHE_KEYS` in `constants.js:103-115` still uses `opensubtitles_*` names and is the one `cache.js` actually uses for guessit, movie-guess, language-detection and features caches — the bulk of backend-derived cached data. Scoping only `CACHE_PREFIXES` would leave those leaking across environments. `CACHE_KEYS` is scoped too, except `DEBUG_MODE` which is a UI preference.

Also noted, **not** fixed here (out of scope): `cache.js:415` and `:613` reference `CACHE_KEYS.XMLRPC_CHECKSUB`, which does not exist in `CACHE_KEYS`. Those loops currently match nothing. Leave as-is; mention it in the final report.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/utils/normalizeBaseUrl.js` (new) | Pure URL normalizer, extracted from `constants.js` to break an import cycle |
| `src/config/environments.js` (new) | Environment registry, gate, active-env resolution, persistence |
| `src/utils/constants.js` (modify) | Derives base URL + API key from the active env; scoped `CACHE_KEYS`; re-exports `normalizeBaseUrl` |
| `src/utils/storageKeys.js` (modify) | Scoped `STORAGE_KEYS` + `CACHE_PREFIXES`; one-shot purge of unscoped keys |
| `src/main.jsx` (modify) | Calls the purge at startup |
| `src/components/EnvironmentSwitch.jsx` (new) | The header control |
| `src/components/SubtitleUploader.jsx` (modify) | Renders the switch in the header |
| `scripts/embed-api-keys.js`, `vite.config.js` (modify) | Embed two keys + the gate flag |
| `.env.example`, `README.md`, `docs/plans/*.md` (modify) | Documentation |

**Why the cycle-breaking extraction (Task 1) comes first:** `constants.js` will import from `environments.js`, and `environments.js` needs `normalizeBaseUrl`, which currently lives in `constants.js`. That is a cycle. Moving the function to its own module and re-exporting it from `constants.js` breaks it while keeping `tests/utils/constants.test.js:8` (which imports `normalizeBaseUrl` from `constants.js`) passing untouched.

Similarly, `environments.js` owns the literal `'osdb_backend'` string, and `storageKeys.js` imports the env id **from** `environments.js` — never the reverse.

---

### Task 1: Extract `normalizeBaseUrl` into its own module

**Files:**
- Create: `src/utils/normalizeBaseUrl.js`
- Modify: `src/utils/constants.js:26-44` (remove the function, add a re-export)
- Test: `tests/utils/constants.test.js` (unchanged — it must keep passing)

**Interfaces:**
- Consumes: nothing
- Produces: `normalizeBaseUrl(raw: string|null|undefined) => string`, plus `DEFAULT_BASE_URL: string`. Task 2 imports both from `src/utils/normalizeBaseUrl.js`.

- [ ] **Step 1: Run the existing tests to record the green baseline**

Run: `npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: `pass 373`, `fail 0`

- [ ] **Step 2: Create the new module**

Create `src/utils/normalizeBaseUrl.js`:

```js
export const DEFAULT_BASE_URL = 'https://api.opensubtitles.com/api/v1';

/**
 * Pure URL normalizer for the API base. Lives in its own module so that
 * both constants.js and config/environments.js can use it without an
 * import cycle (constants.js imports environments.js).
 *
 *   normalizeBaseUrl(undefined)                        → DEFAULT_BASE_URL
 *   normalizeBaseUrl('')                               → DEFAULT_BASE_URL
 *   normalizeBaseUrl('http://localhost:3001')          → 'http://localhost:3001/api/v1'
 *   normalizeBaseUrl('http://localhost:3001/api/v1/')  → 'http://localhost:3001/api/v1'
 *   normalizeBaseUrl('https://x.com/api/v2')           → 'https://x.com/api/v2'
 */
export function normalizeBaseUrl(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'string') return DEFAULT_BASE_URL;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_BASE_URL;
  if (!/\/api\/v\d+$/.test(trimmed)) return trimmed + '/api/v1';
  return trimmed;
}
```

- [ ] **Step 3: Replace the definition in `constants.js` with a re-export**

In `src/utils/constants.js`, delete lines 24-44 (the `DEFAULT_BASE_URL` const and the whole `normalizeBaseUrl` function including its doc comment) and put this in their place:

```js
// Base URL normalization lives in its own module to avoid an import cycle
// with config/environments.js. Re-exported here for backwards compatibility.
export { DEFAULT_BASE_URL, normalizeBaseUrl } from './normalizeBaseUrl.js';
```

Add the import at the top of the file (below the existing imports):

```js
import { normalizeBaseUrl } from './normalizeBaseUrl.js';
```

The local `import` is needed because line 46 still calls `normalizeBaseUrl(...)`.

- [ ] **Step 4: Run the tests — they must still pass unchanged**

Run: `npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: `pass 373`, `fail 0`. The existing `normalizeBaseUrl` tests in `tests/utils/constants.test.js` now exercise the re-export.

- [ ] **Step 5: Verify the build still resolves**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built in <N>s`

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/utils/normalizeBaseUrl.js src/utils/constants.js
git add src/utils/normalizeBaseUrl.js src/utils/constants.js
git commit -m "refactor: extract normalizeBaseUrl to its own module

Breaks the cycle that would otherwise form when constants.js imports
config/environments.js, which itself needs the normalizer. Re-exported
from constants.js so existing importers are unaffected."
```

---

### Task 2: Environment registry

**Files:**
- Create: `src/config/environments.js`
- Test: `tests/config/environments.test.js`

**Interfaces:**
- Consumes: `normalizeBaseUrl`, `DEFAULT_BASE_URL` from `src/utils/normalizeBaseUrl.js` (Task 1)
- Produces:
  - `BACKEND_PREF_KEY: 'osdb_backend'`
  - `SWITCH_ENABLED: boolean`
  - `ENVIRONMENTS: { prod: Env, dev: Env }` where `Env = { id, label, baseUrl, apiKey }`
  - `listSelectableEnvironments(): Env[]`
  - `getActiveEnvironmentId(storage?): 'prod'|'dev'`
  - `getActiveEnvironment(storage?): Env`
  - `setActiveEnvironment(id, { storage?, reload? }): boolean`
  - Task 3 uses `getActiveEnvironment`. Task 4 uses `getActiveEnvironmentId` and `BACKEND_PREF_KEY`. Task 7 uses `SWITCH_ENABLED`, `listSelectableEnvironments`, `getActiveEnvironmentId`, `setActiveEnvironment`.

- [ ] **Step 1: Write the failing test**

Create `tests/config/environments.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENTS,
  BACKEND_PREF_KEY,
  resolveEnvironmentId,
  buildSelectableList,
} from '../../src/config/environments.js';

class MemoryStorage {
  constructor(seed = {}) {
    this._m = new Map(Object.entries(seed));
  }
  getItem(k) {
    return this._m.has(k) ? this._m.get(k) : null;
  }
  setItem(k, v) {
    this._m.set(k, String(v));
  }
  removeItem(k) {
    this._m.delete(k);
  }
}

describe('resolveEnvironmentId', () => {
  test('empty storage with switch enabled defaults to dev', () => {
    assert.equal(resolveEnvironmentId(new MemoryStorage(), true), 'dev');
  });

  test('empty storage with switch disabled defaults to prod', () => {
    assert.equal(resolveEnvironmentId(new MemoryStorage(), false), 'prod');
  });

  test('stored dev is honoured when the switch is enabled', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'dev' });
    assert.equal(resolveEnvironmentId(s, true), 'dev');
  });

  test('GATING INVARIANT: stored dev is ignored when the switch is disabled', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'dev' });
    assert.equal(resolveEnvironmentId(s, false), 'prod');
  });

  test('unknown stored id falls back to the default', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'staging' });
    assert.equal(resolveEnvironmentId(s, true), 'dev');
    assert.equal(resolveEnvironmentId(s, false), 'prod');
  });

  test('legacy dual-endpoint values (com/org) are not valid ids', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'com' });
    assert.equal(resolveEnvironmentId(s, true), 'dev');
  });

  test('missing storage does not throw', () => {
    assert.equal(resolveEnvironmentId(null, false), 'prod');
    assert.equal(resolveEnvironmentId(undefined, true), 'dev');
  });
});

describe('buildSelectableList', () => {
  test('is empty when the switch is disabled', () => {
    assert.deepEqual(buildSelectableList(false, ENVIRONMENTS), []);
  });

  test('omits dev when its base URL is not configured', () => {
    const envs = { ...ENVIRONMENTS, dev: { ...ENVIRONMENTS.dev, baseUrl: '' } };
    const ids = buildSelectableList(true, envs).map(e => e.id);
    assert.deepEqual(ids, ['prod']);
  });

  test('lists prod first, then dev, when both are configured', () => {
    const envs = {
      ...ENVIRONMENTS,
      dev: { ...ENVIRONMENTS.dev, baseUrl: 'https://osdev.ngrok.dev/api/v1' },
    };
    const ids = buildSelectableList(true, envs).map(e => e.id);
    assert.deepEqual(ids, ['prod', 'dev']);
  });
});

describe('ENVIRONMENTS shape', () => {
  test('prod always has the canonical base URL', () => {
    assert.equal(ENVIRONMENTS.prod.baseUrl, 'https://api.opensubtitles.com/api/v1');
  });

  test('every environment declares id and label', () => {
    for (const [id, env] of Object.entries(ENVIRONMENTS)) {
      assert.equal(env.id, id);
      assert.ok(env.label.length > 0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/config/environments.test.js`
Expected: FAIL — `Cannot find module '.../src/config/environments.js'`

- [ ] **Step 3: Write the implementation**

Create `src/config/environments.js`:

```js
import { normalizeBaseUrl, DEFAULT_BASE_URL } from '../utils/normalizeBaseUrl.js';

/**
 * Backend environment registry.
 *
 * The uploader can talk to exactly two backends: production, and the dev
 * server exposed through a stable ngrok subdomain. The switch that selects
 * between them ships ONLY in dev/test builds — see SWITCH_ENABLED.
 *
 * This module owns the 'osdb_backend' storage key. utils/storageKeys.js
 * imports FROM here, never the other way around.
 *
 * Design: docs/superpowers/specs/2026-08-14-env-switch-design.md
 */

export const BACKEND_PREF_KEY = 'osdb_backend';

const readEnv = name => {
  if (typeof import.meta === 'undefined' || !import.meta.env) return '';
  return import.meta.env[name] || '';
};

// Compile-time globals (vite `define`), with import.meta.env fallbacks for
// the dev server. Mirrors the pattern already used for the API key.
const PROD_KEY =
  typeof __EMBEDDED_OPENSUBTITLES_API_KEY_PROD__ !== 'undefined' &&
  __EMBEDDED_OPENSUBTITLES_API_KEY_PROD__
    ? __EMBEDDED_OPENSUBTITLES_API_KEY_PROD__
    : readEnv('VITE_OPENSUBTITLES_API_KEY_PROD');

// The legacy single-key variable is accepted as a fallback for DEV only —
// that is what it holds in existing .env files. It is deliberately NOT a
// fallback for the prod key: a silently wrong key against prod Kong is
// worse than a loud startup error.
const DEV_KEY =
  typeof __EMBEDDED_OPENSUBTITLES_API_KEY_DEV__ !== 'undefined' &&
  __EMBEDDED_OPENSUBTITLES_API_KEY_DEV__
    ? __EMBEDDED_OPENSUBTITLES_API_KEY_DEV__
    : readEnv('VITE_OPENSUBTITLES_API_KEY_DEV') || readEnv('VITE_OPENSUBTITLES_API_KEY');

const DEV_BASE_URL_RAW = readEnv('VITE_OPENSUBTITLES_BASE_URL');

export const SWITCH_ENABLED =
  (typeof __ENV_SWITCH_ENABLED__ !== 'undefined' && __ENV_SWITCH_ENABLED__ === 'true') ||
  readEnv('VITE_ENV_SWITCH') === 'true';

export const ENVIRONMENTS = Object.freeze({
  prod: Object.freeze({
    id: 'prod',
    label: 'Production',
    baseUrl: DEFAULT_BASE_URL,
    apiKey: PROD_KEY,
  }),
  dev: Object.freeze({
    id: 'dev',
    label: 'Dev (ngrok)',
    baseUrl: DEV_BASE_URL_RAW ? normalizeBaseUrl(DEV_BASE_URL_RAW) : '',
    apiKey: DEV_KEY,
  }),
});

const VALID_IDS = Object.freeze(['prod', 'dev']);

/**
 * Pure resolver — exported for tests.
 *
 * The gating invariant: when the switch is disabled, this ALWAYS returns
 * 'prod', whatever storage says. A public build must never be dragged onto
 * the dev backend by a leftover preference from a tester build.
 *
 * @param {Storage|null} storage
 * @param {boolean} switchEnabled
 * @returns {'prod'|'dev'}
 */
export function resolveEnvironmentId(storage, switchEnabled) {
  if (!switchEnabled) return 'prod';
  const fallback = 'dev';
  if (!storage || typeof storage.getItem !== 'function') return fallback;
  let stored = null;
  try {
    stored = storage.getItem(BACKEND_PREF_KEY);
  } catch {
    return fallback;
  }
  return VALID_IDS.includes(stored) ? stored : fallback;
}

/**
 * Pure list builder — exported for tests.
 * @returns {Array<object>} prod first, then dev when it is configured
 */
export function buildSelectableList(switchEnabled, environments) {
  if (!switchEnabled) return [];
  return VALID_IDS.map(id => environments[id]).filter(env => env && env.baseUrl);
}

const defaultStorage = () =>
  typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null;

export function getActiveEnvironmentId(storage = defaultStorage()) {
  return resolveEnvironmentId(storage, SWITCH_ENABLED);
}

export function getActiveEnvironment(storage = defaultStorage()) {
  return ENVIRONMENTS[getActiveEnvironmentId(storage)];
}

export function listSelectableEnvironments() {
  return buildSelectableList(SWITCH_ENABLED, ENVIRONMENTS);
}

/**
 * Persist the choice and reload so every module re-resolves the backend.
 *
 * @param {'prod'|'dev'} id
 * @param {{storage?: Storage, reload?: Function}} deps injectable for tests
 * @returns {boolean} true when a reload was triggered
 */
export function setActiveEnvironment(id, deps = {}) {
  const storage = deps.storage ?? defaultStorage();
  const reload =
    deps.reload ??
    (() => {
      if (typeof window !== 'undefined') window.location.reload();
    });

  if (!VALID_IDS.includes(id) || !SWITCH_ENABLED) return false;
  if (getActiveEnvironmentId(storage) === id) return false;

  try {
    storage?.setItem(BACKEND_PREF_KEY, id);
  } catch {
    return false;
  }
  reload();
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/config/environments.test.js`
Expected: PASS, 12 tests.

Note: in Node, `import.meta.env` is undefined and the `__EMBEDDED_*__` globals do not exist, so `SWITCH_ENABLED` is `false` and `ENVIRONMENTS.dev.baseUrl` is `''` under test. Every test above either passes explicit arguments to the pure functions or asserts behaviour that holds regardless — which is exactly why `resolveEnvironmentId` and `buildSelectableList` take their inputs as parameters.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/config/environments.js tests/config/environments.test.js
git add src/config/environments.js tests/config/environments.test.js
git commit -m "feat: environment registry for dev/prod backend switching

Owns the registry, the build-time gate and active-environment resolution.
The gating invariant — switch disabled always resolves to prod, ignoring
stored preferences — has a dedicated test."
```

---

### Task 3: Wire `constants.js` to the active environment

**Files:**
- Modify: `src/utils/constants.js:6-11` (API key), `:46-50` (base URL), `:71-95` (`validateApiConfiguration`)
- Test: `tests/utils/constants.test.js`

**Interfaces:**
- Consumes: `getActiveEnvironment`, `getActiveEnvironmentId` from Task 2
- Produces: `OPENSUBTITLES_BASE_URL` and `OPENSUBTITLES_COM_API_KEY` now reflect the active environment. `API_ENDPOINTS` and `RestClient` are unchanged and pick this up for free.

- [ ] **Step 1: Write the failing test**

Append to `tests/utils/constants.test.js`:

```js
import { getActiveEnvironment } from '../../src/config/environments.js';
import { OPENSUBTITLES_BASE_URL, API_ENDPOINTS } from '../../src/utils/constants.js';

describe('active environment wiring', () => {
  test('base URL matches the active environment', () => {
    assert.equal(OPENSUBTITLES_BASE_URL, getActiveEnvironment().baseUrl);
  });

  test('every endpoint is derived from the active base URL', () => {
    assert.ok(API_ENDPOINTS.FEATURES.startsWith(OPENSUBTITLES_BASE_URL));
    assert.ok(API_ENDPOINTS.GUESSIT.startsWith(OPENSUBTITLES_BASE_URL));
    assert.ok(API_ENDPOINTS.LANGUAGE_DETECTION.startsWith(OPENSUBTITLES_BASE_URL));
    assert.ok(API_ENDPOINTS.SUPPORTED_LANGUAGES.startsWith(OPENSUBTITLES_BASE_URL));
    assert.equal(API_ENDPOINTS.OPENSUBTITLES_REST, OPENSUBTITLES_BASE_URL);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/utils/constants.test.js`
Expected: FAIL — base URL still resolves from `import.meta.env`, which is `undefined` in Node, so it equals `DEFAULT_BASE_URL` while `getActiveEnvironment()` is consulted separately. The assertion that catches a real regression here is the endpoint-derivation one; keep both.

- [ ] **Step 3: Rewrite the two resolutions**

In `src/utils/constants.js`, add to the imports:

```js
import { getActiveEnvironment, getActiveEnvironmentId } from '../config/environments.js';
```

Replace lines 6-11 (the `OPENSUBTITLES_COM_API_KEY` block) with:

```js
// API key and base URL both come from the active environment — see
// src/config/environments.js. Resolved once at module load; switching
// environments reloads the window, so these constants stay valid.
export const OPENSUBTITLES_COM_API_KEY = getActiveEnvironment().apiKey;
```

Replace lines 46-50 (the `OPENSUBTITLES_BASE_URL` block) with:

```js
export const OPENSUBTITLES_BASE_URL = getActiveEnvironment().baseUrl;
```

- [ ] **Step 4: Extend `validateApiConfiguration` to name the environment**

Replace the body of `validateApiConfiguration` (lines 71-95) with:

```js
export const validateApiConfiguration = () => {
  const errors = [];
  const envId = getActiveEnvironmentId();

  if (!OPENSUBTITLES_COM_API_KEY) {
    errors.push(
      `No API key for the "${envId}" environment. Set VITE_OPENSUBTITLES_API_KEY_${envId.toUpperCase()} in .env (see .env.example).`
    );
  }

  if (!OPENSUBTITLES_BASE_URL) {
    errors.push(`No base URL configured for the "${envId}" environment.`);
  }

  console.log(`🌐 API environment: ${envId} → ${OPENSUBTITLES_BASE_URL}`);

  if (errors.length > 0) {
    console.error('⚠️ API Configuration Issues:');
    errors.forEach(error => console.error(`  - ${error}`));
    console.error('Please copy .env.example to .env and configure your API credentials.');
    return false;
  }

  return true;
};
```

Note: the key itself is never logged, only whether it is missing.

- [ ] **Step 5: Run the full test suite**

Run: `npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: `fail 0`, total count higher than 373.

- [ ] **Step 6: Verify the build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built in <N>s`

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/utils/constants.js tests/utils/constants.test.js
git add src/utils/constants.js tests/utils/constants.test.js
git commit -m "feat: derive API base URL and key from the active environment

API_ENDPOINTS and RestClient need no changes — they read these constants,
and switching environments reloads the window."
```

---

### Task 4: Scope every storage key by environment

**Files:**
- Modify: `src/utils/storageKeys.js:13-34` (`STORAGE_KEYS`, `CACHE_PREFIXES`)
- Modify: `src/utils/constants.js:103-115` (`CACHE_KEYS`)
- Test: `tests/utils/storageKeys.test.js`, `tests/utils/constants.test.js`

**Interfaces:**
- Consumes: `getActiveEnvironmentId`, `BACKEND_PREF_KEY` from Task 2
- Produces: `buildStorageKeys(envId)`, `buildCachePrefixes(envId)` from `storageKeys.js`; `buildCacheKeys(envId)` from `constants.js`. The frozen `STORAGE_KEYS`, `CACHE_PREFIXES` and `CACHE_KEYS` exports keep their names and are built from the active env id. **No consumer changes anywhere.**

- [ ] **Step 1: Write the failing test**

Append to `tests/utils/storageKeys.test.js`:

```js
import { buildStorageKeys, buildCachePrefixes } from '../../src/utils/storageKeys.js';

describe('environment-scoped keys', () => {
  test('auth keys carry the environment as an infix', () => {
    const dev = buildStorageKeys('dev');
    assert.equal(dev.JWT, 'osdb_com_dev_jwt');
    assert.equal(dev.USER, 'osdb_com_dev_user');
    assert.equal(dev.LOGIN_TIME, 'osdb_com_dev_login_time');
  });

  test('prod and dev never collide', () => {
    const dev = buildStorageKeys('dev');
    const prod = buildStorageKeys('prod');
    assert.notEqual(dev.JWT, prod.JWT);
    assert.equal(prod.JWT, 'osdb_com_prod_jwt');
  });

  test('scoped auth keys still satisfy the osdb_com_ prefix contract', () => {
    for (const id of ['dev', 'prod']) {
      const k = buildStorageKeys(id);
      assert.match(k.JWT, /^osdb_com_/);
      assert.match(k.USER, /^osdb_com_/);
      assert.match(k.LOGIN_TIME, /^osdb_com_/);
    }
  });

  test('the backend preference key is NOT scoped — it is the selector', () => {
    assert.equal(buildStorageKeys('dev').BACKEND_PREF, 'osdb_backend');
    assert.equal(buildStorageKeys('prod').BACKEND_PREF, 'osdb_backend');
  });

  test('migration markers and remembered username are NOT scoped', () => {
    const dev = buildStorageKeys('dev');
    const prod = buildStorageKeys('prod');
    assert.equal(dev.MIGRATION_V2_DONE, prod.MIGRATION_V2_DONE);
    assert.equal(dev.REMEMBERED_USERNAME, prod.REMEMBERED_USERNAME);
  });

  test('cache prefixes carry the environment and keep their trailing separator', () => {
    const dev = buildCachePrefixes('dev');
    assert.equal(dev.LANGUAGES, 'rest_dev_languages_cache');
    assert.equal(dev.FEATURES_IMDB, 'rest_dev_features_cache:imdb:');
    assert.equal(dev.FEATURES_QUERY, 'rest_dev_features_cache:query:');
    assert.equal(dev.MOVIE_GUESS, 'rest_dev_movie_guess_cache:');
    assert.equal(dev.CHECK, 'rest_dev_check_cache:');
    assert.equal(dev.LANG_DETECT, 'rest_dev_lang_detect_cache:');
    assert.equal(dev.GUESSIT, 'rest_dev_guessit_cache:');
  });

  test('scoped cache prefixes still satisfy the rest_ prefix contract', () => {
    for (const v of Object.values(buildCachePrefixes('prod'))) {
      assert.match(v, /^rest_/);
    }
  });
});
```

Append to `tests/utils/constants.test.js`:

```js
import { buildCacheKeys } from '../../src/utils/constants.js';

describe('environment-scoped CACHE_KEYS', () => {
  test('cache keys carry the environment as an infix', () => {
    const dev = buildCacheKeys('dev');
    assert.equal(dev.GUESSIT_CACHE, 'opensubtitles_dev_guessit_cache');
    assert.equal(dev.MOVIE_GUESS_CACHE, 'opensubtitles_dev_movie_guess_cache');
    assert.equal(dev.LANGUAGE_DETECTION_CACHE, 'opensubtitles_dev_language_detection_cache');
    assert.equal(dev.FEATURES_CACHE, 'opensubtitles_dev_features_cache');
    assert.equal(dev.LANGUAGES, 'opensubtitles_dev_languages_cache');
  });

  test('expiry twins keep the _expiry suffix so cache.js filters keep working', () => {
    const dev = buildCacheKeys('dev');
    for (const name of [
      'LANGUAGES_EXPIRY',
      'GUESSIT_CACHE_EXPIRY',
      'MOVIE_GUESS_CACHE_EXPIRY',
      'LANGUAGE_DETECTION_CACHE_EXPIRY',
      'FEATURES_CACHE_EXPIRY',
    ]) {
      assert.ok(dev[name].endsWith('_expiry'), `${name} must end with _expiry`);
    }
  });

  test('an expiry key is exactly its base key plus _expiry', () => {
    const dev = buildCacheKeys('dev');
    assert.equal(dev.GUESSIT_CACHE_EXPIRY, dev.GUESSIT_CACHE + '_expiry');
    assert.equal(dev.FEATURES_CACHE_EXPIRY, dev.FEATURES_CACHE + '_expiry');
  });

  test('DEBUG_MODE is a UI preference and is NOT scoped', () => {
    assert.equal(buildCacheKeys('dev').DEBUG_MODE, buildCacheKeys('prod').DEBUG_MODE);
    assert.equal(buildCacheKeys('dev').DEBUG_MODE, 'opensubtitles_debug_mode');
  });

  test('prod and dev cache keys never collide', () => {
    assert.notEqual(buildCacheKeys('dev').FEATURES_CACHE, buildCacheKeys('prod').FEATURES_CACHE);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/utils/storageKeys.test.js tests/utils/constants.test.js`
Expected: FAIL — `buildStorageKeys is not a function` / `buildCachePrefixes is not a function` / `buildCacheKeys is not a function`

- [ ] **Step 3: Implement the builders in `storageKeys.js`**

In `src/utils/storageKeys.js`, add the import at the top:

```js
import { getActiveEnvironmentId, BACKEND_PREF_KEY } from '../config/environments.js';
```

Replace the `STORAGE_KEYS` block (lines 13-24) and the `CACHE_PREFIXES` block (lines 26-34) with:

```js
/**
 * Auth keys, scoped to a backend environment.
 *
 * The environment id is an INFIX, not a suffix: 'osdb_com_dev_jwt', not
 * 'osdb_com_jwt:dev'. That keeps the osdb_com_ prefix contract intact and,
 * for the cache keys below, keeps the '_expiry' suffix at the end where
 * cache.js's endsWith() filters expect it.
 *
 * Exported as a pure builder so tests can check both environments without
 * module-cache tricks.
 */
export const buildStorageKeys = envId =>
  Object.freeze({
    JWT: `osdb_com_${envId}_jwt`,
    USER: `osdb_com_${envId}_user`,
    LOGIN_TIME: `osdb_com_${envId}_login_time`,
    // Cosmetic "remember last username" — identical across environments
    REMEMBERED_USERNAME: 'opensubtitles_remembered_username',
    // Migration markers — global by definition
    MIGRATION_V2_DONE: 'osdb_migration_v2_done',
    MIGRATION_V3_DONE: 'osdb_migration_v3_done',
    // The environment selector itself. Never scoped — it is what chooses
    // the scope. Owned by config/environments.js.
    BACKEND_PREF: BACKEND_PREF_KEY,
  });

export const buildCachePrefixes = envId =>
  Object.freeze({
    LANGUAGES: `rest_${envId}_languages_cache`,
    FEATURES_IMDB: `rest_${envId}_features_cache:imdb:`,
    FEATURES_QUERY: `rest_${envId}_features_cache:query:`,
    MOVIE_GUESS: `rest_${envId}_movie_guess_cache:`,
    CHECK: `rest_${envId}_check_cache:`,
    LANG_DETECT: `rest_${envId}_lang_detect_cache:`,
    GUESSIT: `rest_${envId}_guessit_cache:`,
  });

export const STORAGE_KEYS = buildStorageKeys(getActiveEnvironmentId());
export const CACHE_PREFIXES = buildCachePrefixes(getActiveEnvironmentId());
```

- [ ] **Step 4: Implement the builder in `constants.js`**

Replace `CACHE_KEYS` (lines 103-115) with:

```js
/**
 * Legacy-named cache keys still used by services/cache.js, scoped per
 * environment. DEBUG_MODE stays global — it is a UI preference, not
 * backend-derived data.
 */
export const buildCacheKeys = envId =>
  Object.freeze({
    LANGUAGES: `opensubtitles_${envId}_languages_cache`,
    LANGUAGES_EXPIRY: `opensubtitles_${envId}_languages_cache_expiry`,
    GUESSIT_CACHE: `opensubtitles_${envId}_guessit_cache`,
    GUESSIT_CACHE_EXPIRY: `opensubtitles_${envId}_guessit_cache_expiry`,
    MOVIE_GUESS_CACHE: `opensubtitles_${envId}_movie_guess_cache`,
    MOVIE_GUESS_CACHE_EXPIRY: `opensubtitles_${envId}_movie_guess_cache_expiry`,
    LANGUAGE_DETECTION_CACHE: `opensubtitles_${envId}_language_detection_cache`,
    LANGUAGE_DETECTION_CACHE_EXPIRY: `opensubtitles_${envId}_language_detection_cache_expiry`,
    FEATURES_CACHE: `opensubtitles_${envId}_features_cache`,
    FEATURES_CACHE_EXPIRY: `opensubtitles_${envId}_features_cache_expiry`,
    DEBUG_MODE: 'opensubtitles_debug_mode',
  });

export const CACHE_KEYS = buildCacheKeys(getActiveEnvironmentId());
```

- [ ] **Step 5: Run the full suite**

Run: `npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: `fail 0`. The pre-existing assertions at `tests/utils/storageKeys.test.js:33-42` still pass because the prefixes are unchanged.

- [ ] **Step 6: Confirm no consumer needed changing**

Run: `git diff --name-only`
Expected: the list must NOT include `sessionUtils.js`, `sessionManager.js`, `authService.js`, `features.js`, `languages.js` or `cache.js`. If it does, the builder approach was not applied correctly — revert those edits.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/utils/storageKeys.js src/utils/constants.js tests/utils/storageKeys.test.js tests/utils/constants.test.js
git add src/utils/storageKeys.js src/utils/constants.js tests/utils/storageKeys.test.js tests/utils/constants.test.js
git commit -m "feat: scope auth and cache storage keys per environment

The environment id becomes an infix in every key name, computed once at
module load. Consumers are untouched: a dev-issued JWT and dev-cached
API responses are now unreachable while prod is active, structurally
rather than by convention.

Covers both cache systems — CACHE_PREFIXES in storageKeys.js and the
legacy-named CACHE_KEYS in constants.js that services/cache.js uses."
```

---

### Task 5: One-shot purge of pre-2.0.0 unscoped keys

**Files:**
- Modify: `src/utils/storageKeys.js` (add `purgeUnscopedKeys`)
- Modify: `src/main.jsx:24-29`
- Test: `tests/utils/storageKeys.test.js`

**Interfaces:**
- Consumes: `STORAGE_KEYS.MIGRATION_V3_DONE` from Task 4
- Produces: `purgeUnscopedKeys(storage?) => boolean`

**Why purge rather than migrate:** there is no way to know which backend an existing unscoped `osdb_com_jwt` came from. Presenting a dev session as a prod one is worse than one re-login (spec D6).

- [ ] **Step 1: Extend `MemoryStorage` in the test file**

The existing `MemoryStorage` class at the top of `tests/utils/storageKeys.test.js` needs iteration support for the purge scan. Add these two members to it:

```js
  key(i) {
    return Array.from(this._m.keys())[i] ?? null;
  }
  get length() {
    return this._m.size;
  }
```

Note: the class already has a `size()` method used by an existing test — leave it alone and add `length` as a getter alongside it.

- [ ] **Step 2: Write the failing test**

Append to `tests/utils/storageKeys.test.js`:

```js
import { purgeUnscopedKeys } from '../../src/utils/storageKeys.js';

describe('purgeUnscopedKeys', () => {
  const seed = () =>
    new MemoryStorage({
      osdb_com_jwt: 'eyJ-old',
      osdb_com_user: '{"name":"alice"}',
      osdb_com_login_time: '123',
      rest_languages_cache: '[]',
      'rest_features_cache:imdb:123': '{}',
      opensubtitles_guessit_cache: '{}',
      // must survive
      osdb_com_dev_jwt: 'eyJ-scoped',
      rest_dev_languages_cache: '[]',
      osdb_backend: 'dev',
      opensubtitles_remembered_username: 'alice',
      opensubtitles_debug_mode: 'true',
    });

  test('removes unscoped auth keys', () => {
    const s = seed();
    purgeUnscopedKeys(s);
    assert.equal(s.getItem('osdb_com_jwt'), null);
    assert.equal(s.getItem('osdb_com_user'), null);
    assert.equal(s.getItem('osdb_com_login_time'), null);
  });

  test('removes unscoped cache entries from both cache systems', () => {
    const s = seed();
    purgeUnscopedKeys(s);
    assert.equal(s.getItem('rest_languages_cache'), null);
    assert.equal(s.getItem('rest_features_cache:imdb:123'), null);
    assert.equal(s.getItem('opensubtitles_guessit_cache'), null);
  });

  test('leaves scoped keys alone', () => {
    const s = seed();
    purgeUnscopedKeys(s);
    assert.equal(s.getItem('osdb_com_dev_jwt'), 'eyJ-scoped');
    assert.equal(s.getItem('rest_dev_languages_cache'), '[]');
  });

  test('leaves deliberately-unscoped keys alone', () => {
    const s = seed();
    purgeUnscopedKeys(s);
    assert.equal(s.getItem('osdb_backend'), 'dev');
    assert.equal(s.getItem('opensubtitles_remembered_username'), 'alice');
    assert.equal(s.getItem('opensubtitles_debug_mode'), 'true');
  });

  test('sets the marker and is idempotent', () => {
    const s = seed();
    assert.equal(purgeUnscopedKeys(s), true);
    assert.equal(s.getItem('osdb_migration_v3_done'), '1');
    s.setItem('osdb_com_jwt', 'snuck-back-in');
    assert.equal(purgeUnscopedKeys(s), false);
    assert.equal(s.getItem('osdb_com_jwt'), 'snuck-back-in');
  });

  test('returns false when no storage is available', () => {
    assert.equal(purgeUnscopedKeys(null), false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/utils/storageKeys.test.js`
Expected: FAIL — `purgeUnscopedKeys is not a function`

- [ ] **Step 4: Implement the purge**

Append to `src/utils/storageKeys.js`:

```js
const getDefaultStorage = () =>
  typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null;

// Keys that are unscoped on purpose and must survive the purge.
const PURGE_EXEMPT = Object.freeze([
  BACKEND_PREF_KEY,
  'osdb_migration_v2_done',
  'osdb_migration_v3_done',
  'opensubtitles_remembered_username',
  'opensubtitles_debug_mode',
]);

// An unscoped key is one whose namespace token is NOT followed by a valid
// environment id.
const UNSCOPED_PATTERNS = Object.freeze([
  /^osdb_com_(?!prod_|dev_)/,
  /^rest_(?!prod_|dev_)/,
  /^opensubtitles_(?!prod_|dev_)/,
]);

/**
 * One-shot removal of auth and cache keys written by pre-2.0.0 builds,
 * before keys were scoped per environment. There is no reliable way to tell
 * which backend those entries came from, so they are dropped rather than
 * guessed at. Users log in again once.
 *
 * Idempotent — the MIGRATION_V3_DONE marker prevents re-runs.
 * MUST run before any service module reads from localStorage.
 *
 * @param {Storage} [storage=localStorage] injectable for tests
 * @returns {boolean} true if the purge ran
 */
export function purgeUnscopedKeys(storage = getDefaultStorage()) {
  if (!storage || typeof storage.getItem !== 'function') return false;

  try {
    if (storage.getItem(STORAGE_KEYS.MIGRATION_V3_DONE)) return false;
  } catch {
    return false;
  }

  const doomed = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || PURGE_EXEMPT.includes(key)) continue;
    if (UNSCOPED_PATTERNS.some(re => re.test(key))) doomed.push(key);
  }

  for (const key of doomed) {
    try {
      storage.removeItem(key);
    } catch {
      // A single failed removal must not abort the purge.
    }
  }

  try {
    storage.setItem(STORAGE_KEYS.MIGRATION_V3_DONE, '1');
  } catch {
    return false;
  }

  return true;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/utils/storageKeys.test.js`
Expected: PASS. The pre-existing test "does not touch non-legacy keys" (around line 103, asserting `migrateLegacyKeys` leaves `osdb_com_jwt` intact) must still pass — `purgeUnscopedKeys` is a separate function and that test never calls it.

- [ ] **Step 6: Call it at startup**

In `src/main.jsx`, change the import on line 5 to:

```js
import { migrateLegacyKeys, purgeUnscopedKeys } from './utils/storageKeys.js';
```

and add directly after the existing `migrateLegacyKeys()` block (after line 29):

```js
// One-shot purge of pre-2.0.0 unscoped auth/cache keys, from before keys
// were namespaced per backend environment. Users log in again once.
if (purgeUnscopedKeys()) {
  console.log('🧹 Purged unscoped localStorage keys (pre-2.0.0)');
}
```

- [ ] **Step 7: Run the full suite and build**

Run: `npm test 2>&1 | grep -E "^. (tests|pass|fail)"` then `npx vite build 2>&1 | tail -3`
Expected: `fail 0`; `✓ built`

- [ ] **Step 8: Commit**

```bash
npx prettier --write src/utils/storageKeys.js src/main.jsx tests/utils/storageKeys.test.js
git add src/utils/storageKeys.js src/main.jsx tests/utils/storageKeys.test.js
git commit -m "feat: purge pre-2.0.0 unscoped localStorage keys once at startup

Entries written before per-environment scoping cannot be attributed to a
backend, so they are dropped rather than guessed at. Costs one re-login."
```

---

### Task 6: Build wiring for two keys and the gate flag

**Files:**
- Modify: `vite.config.js:30-35`
- Modify: `scripts/embed-api-keys.js:14-17` and its generated template
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing
- Produces: the globals `__EMBEDDED_OPENSUBTITLES_API_KEY_PROD__`, `__EMBEDDED_OPENSUBTITLES_API_KEY_DEV__`, `__ENV_SWITCH_ENABLED__` that Task 2 reads.

- [ ] **Step 1: Update the vite define block**

In `vite.config.js`, replace the `define` block (lines 30-35) with:

```js
  define: {
    __EMBEDDED_OPENSUBTITLES_API_KEY_PROD__: JSON.stringify(
      process.env.OPENSUBTITLES_API_KEY_PROD || process.env.VITE_OPENSUBTITLES_API_KEY_PROD || ''
    ),
    __EMBEDDED_OPENSUBTITLES_API_KEY_DEV__: JSON.stringify(
      process.env.OPENSUBTITLES_API_KEY_DEV ||
        process.env.VITE_OPENSUBTITLES_API_KEY_DEV ||
        process.env.VITE_OPENSUBTITLES_API_KEY ||
        ''
    ),
    __ENV_SWITCH_ENABLED__: JSON.stringify(process.env.VITE_ENV_SWITCH || ''),
    global: 'globalThis',
  },
```

- [ ] **Step 2: Update the embed script's key resolution**

In `scripts/embed-api-keys.js`, replace the `API_KEYS` object (lines 14-17) with:

```js
const API_KEYS = {
  PROD: process.env.OPENSUBTITLES_API_KEY_PROD || process.env.VITE_OPENSUBTITLES_API_KEY_PROD || '',
  DEV:
    process.env.OPENSUBTITLES_API_KEY_DEV ||
    process.env.VITE_OPENSUBTITLES_API_KEY_DEV ||
    process.env.VITE_OPENSUBTITLES_API_KEY ||
    '',
};
```

- [ ] **Step 3: Update the generated template**

In the template string inside `generateEmbeddedConstants()`, replace everything from `// Embedded API Keys` to the end of the template with:

```js
// Embedded API Keys (one per backend environment)
export const EMBEDDED_OPENSUBTITLES_API_KEY_PROD = '${API_KEYS.PROD}';
export const EMBEDDED_OPENSUBTITLES_API_KEY_DEV = '${API_KEYS.DEV}';

// Build information
export const BUILD_TIMESTAMP = '${timestamp}';
export const HAS_EMBEDDED_KEYS = ${!!API_KEYS.PROD};

// Validation
export const validateEmbeddedKeys = () => {
  const errors = [];

  if (!EMBEDDED_OPENSUBTITLES_API_KEY_PROD) {
    errors.push('Production API key not embedded at compile time');
  }

  return {
    isValid: errors.length === 0,
    errors,
    hasEmbeddedKeys: HAS_EMBEDDED_KEYS
  };
};

console.log('📦 Embedded constants loaded:', {
  hasProdKey: !!EMBEDDED_OPENSUBTITLES_API_KEY_PROD,
  hasDevKey: !!EMBEDDED_OPENSUBTITLES_API_KEY_DEV,
  buildTime: BUILD_TIMESTAMP
});
```

This deletes the `getEmbeddedApiKey` export (nothing imports it — `constants.js` reads the vite global, not this file) and the `apiKeyPreview` line, which printed the first and last four characters of the key. Partial key exposure is forbidden by the project security rules ("NEVER show partial tokens").

- [ ] **Step 4: Update the script's own logging**

Replace the summary log inside `generateEmbeddedConstants()`:

```js
  console.log('📊 Embedded API keys:', {
    prod: API_KEYS.PROD ? '✅ Present' : '❌ Missing',
    dev: API_KEYS.DEV ? '✅ Present' : '❌ Missing',
    buildTime: timestamp
  });
```

Change the returned object to `hasKeys: !!API_KEYS.PROD`, and replace the two warning lines under `if (!result.hasKeys)`:

```js
      console.warn('⚠️  Warning: no production API key found in environment variables');
      console.warn('   Set OPENSUBTITLES_API_KEY_PROD for production builds');
```

- [ ] **Step 5: Verify the generator runs and leaks nothing**

Run: `node scripts/embed-api-keys.js`
Expected: exit 0. The output must show `prod:`/`dev:` presence flags and **no** key characters.

Run: `grep -c "EMBEDDED_OPENSUBTITLES_API_KEY_" src/utils/embeddedConstants.js`
Expected: at least `4`.

- [ ] **Step 6: Verify both build profiles**

Run: `VITE_ENV_SWITCH=true npx vite build 2>&1 | tail -3`
Expected: `✓ built in <N>s`

- [ ] **Step 7: Restore the generated file**

Run: `git checkout -- src/utils/embeddedConstants.js`
The generated artifact is rebuilt at release time; local timestamp churn is noise in the commit.

- [ ] **Step 8: Replace `.env.example`**

Write `.env.example` in full:

```bash
# OpenSubtitles Uploader — environment configuration
# Copy this file to .env and fill in your values.
# Vite reads VITE_* variables at dev-server and build time.

# ---------------------------------------------------------------------------
# API keys — one per backend environment
# The "Api-Key" header is required on every request.
# Get a key from: https://www.opensubtitles.com/en/consumers
# ---------------------------------------------------------------------------

# Production key. Required for any build that can reach production.
VITE_OPENSUBTITLES_API_KEY_PROD=your_prod_api_key_here

# Dev-backend key. Only needed for builds that talk to the dev server.
VITE_OPENSUBTITLES_API_KEY_DEV=your_dev_api_key_here

# Deprecated: the old single-key variable. Still accepted, but ONLY as a
# fallback for the dev key — never for production.
# VITE_OPENSUBTITLES_API_KEY=

# ---------------------------------------------------------------------------
# Dev backend base URL
# Production is hard-wired to https://api.opensubtitles.com/api/v1 and is not
# configurable. This sets the "Dev (ngrok)" environment only.
#
#   Local Rails:  http://localhost:3001/api/v1
#   ngrok:        https://osdev.ngrok.dev/api/v1
#
# The /api/v1 suffix is appended if you omit it; trailing slashes are stripped.
# Leave unset and the dev environment is not selectable.
# ---------------------------------------------------------------------------
VITE_OPENSUBTITLES_BASE_URL=https://osdev.ngrok.dev/api/v1

# ---------------------------------------------------------------------------
# Environment switch
# 'true' shows the dev/prod switch in the header. Leave unset for public
# builds: they are hard-wired to production and ignore any stored preference.
# ---------------------------------------------------------------------------
VITE_ENV_SWITCH=true
```

- [ ] **Step 9: Commit**

```bash
npx prettier --write vite.config.js scripts/embed-api-keys.js
git add vite.config.js scripts/embed-api-keys.js .env.example
git commit -m "build: embed one API key per environment plus the switch flag

Adds __EMBEDDED_OPENSUBTITLES_API_KEY_PROD__/_DEV__ and
__ENV_SWITCH_ENABLED__. Drops the masked key preview from the generated
file — partial key exposure is disallowed by the project security rules."
```

---

### Task 7: The header switch component

**Files:**
- Create: `src/components/EnvironmentSwitch.jsx`
- Modify: `src/components/SubtitleUploader.jsx` (imports, plus the header block at line 2436)

**Interfaces:**
- Consumes: `SWITCH_ENABLED`, `listSelectableEnvironments`, `getActiveEnvironmentId`, `setActiveEnvironment` from Task 2
- Produces: default-exported `<EnvironmentSwitch />`, no props

This task has no unit test: the component's only logic is delegation to Task 2's functions, which are already tested, and this repo has no React testing library configured. Do not add one for this — verify in the browser instead.

- [ ] **Step 1: Create the component**

Create `src/components/EnvironmentSwitch.jsx`:

```jsx
import React from 'react';
import { Server } from 'lucide-react';
import {
  SWITCH_ENABLED,
  listSelectableEnvironments,
  getActiveEnvironmentId,
  setActiveEnvironment,
} from '../config/environments.js';

/**
 * Backend environment switch. Renders nothing unless the build was made with
 * VITE_ENV_SWITCH=true, so public builds carry no dead chrome.
 *
 * Changing the environment persists the choice and reloads the window —
 * every module then re-resolves the backend from scratch.
 */
export default function EnvironmentSwitch() {
  if (!SWITCH_ENABLED) return null;

  const options = listSelectableEnvironments();
  if (options.length < 2) return null;

  const activeId = getActiveEnvironmentId();
  const isDev = activeId === 'dev';

  const handleChange = event => {
    setActiveEnvironment(event.target.value);
  };

  return (
    <div className="flex items-center gap-2" title="Which backend receives uploads">
      <Server className={`w-4 h-4 ${isDev ? 'text-warning' : 'text-success'}`} aria-hidden="true" />
      <select
        className={`select select-bordered select-xs ${isDev ? 'select-warning' : ''}`}
        value={activeId}
        onChange={handleChange}
        aria-label="Backend environment"
      >
        {options.map(env => (
          <option key={env.id} value={env.id}>
            {env.label}
          </option>
        ))}
      </select>
      {isDev && <span className="badge badge-warning badge-sm">DEV</span>}
    </div>
  );
}
```

- [ ] **Step 2: Render it in the header**

In `src/components/SubtitleUploader.jsx`, add to the imports at the top:

```jsx
import EnvironmentSwitch from './EnvironmentSwitch.jsx';
```

Find the header block at line 2436 (marked `{/* Header */}`). Locate the flex row holding the right-hand header controls — the same row as the existing user/profile and theme controls — and add `<EnvironmentSwitch />` as its first child, so the switch sits to the left of the existing controls.

If the control row is not obvious, place it immediately after the opening tag of the header's right-hand `div` and confirm the placement visually in Step 3.

- [ ] **Step 3: Verify in the browser**

Per project CLAUDE.md, **never** start the dev server yourself. Ask the user to run:

```bash
VITE_ENV_SWITCH=true npm run dev
```

and to confirm:
- The switch appears in the header showing "Dev (ngrok)" with an orange DEV badge
- Selecting "Production" reloads the page and the badge disappears
- After the reload the console prints `🌐 API environment: prod → https://api.opensubtitles.com/api/v1`
- Selecting "Dev (ngrok)" reloads back and the console prints the ngrok URL
- Logging in on one environment and then switching does **not** carry the session across

- [ ] **Step 4: Verify the public build hides it**

Run: `npx vite build 2>&1 | tail -3` (with no `VITE_ENV_SWITCH` set)

Ask the user to run `npm run preview` and confirm no switch appears in the header. The component's strings may still be present in the bundle — what matters is that `SWITCH_ENABLED` is false at runtime, so it renders `null`.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/EnvironmentSwitch.jsx src/components/SubtitleUploader.jsx
git add src/components/EnvironmentSwitch.jsx src/components/SubtitleUploader.jsx
git commit -m "feat: dev/prod environment switch in the header

Renders only in builds made with VITE_ENV_SWITCH=true. Dev is styled as a
warning so a tester can never be unsure which backend receives uploads."
```

---

### Task 8: Rewrite the plan docs around a production smoke test

**Files:**
- Modify: `docs/plans/08-testing-strategy.md` (§6 at lines 180-232; the checklist at 286-331; the file list at 361-363)
- Modify: `docs/plans/00-README.md` (line 24, the status-board row at 39, the exit-criteria callout at 67)
- Modify: `docs/plans/05-upload-flow.md:330`
- Modify: `docs/plans/06-my-uploads-integration.md:249`

No code, no tests. Prose only.

- [ ] **Step 1: Replace §6 of `08-testing-strategy.md`**

Delete the whole "Integration against staging" section (lines 180-232, covering `tests/integration/staging.test.js`, the `STAGING_TEST=1` harness and the golden-replay-against-staging description) and replace it with:

```markdown
## 6. Smoke test against production

Staging is not a viable target. It runs against the **production database**,
it does **not run sidekiq**, and it has **no dedicated opensearch indexes**.
An upload performed there is never properly saved or indexed — the test would
look green while exercising less than it claims, and it writes into the prod
DB regardless. That is the risk of production without the fidelity.

The smoke test therefore runs against production, using the environment
switch (`docs/superpowers/specs/2026-08-14-env-switch-design.md`).

**Prerequisite:** the API is deployed in production; the **Kong routes** must
exist before this can run.

**Traceability.** Test uploads are identifiable two independent ways:
subtitle source and upload date, and the `User-Agent` string — `OpenSubtitles
Uploader PRO v2.0.0` (`src/utils/constants.js:53`), which no other build
emits.

### Procedure

1. Build with the switch enabled: `VITE_ENV_SWITCH=true npm run tauri:build`
2. Launch, set the header switch to **Production**, and log in.
3. Upload one subtitle for a film already in the database. Confirm the
   response carries a subtitle id and the entry appears under Upload history.
4. Upload one subtitle for a title that is **not** in the database, using the
   create-from-id flow ([[11-stub-feature-from-imdb-tmdb]]).
5. Upload one episode subtitle, confirming it attaches to the episode and not
   to the parent series.
6. Delete each test upload through the app.
7. Confirm server-side that the rows are gone and no orphaned features remain.

Anything that fails here blocks the release.
```

- [ ] **Step 2: Remove the staging CI job and secrets note**

In the same file: delete the `staging-smoke:` CI job (around line 315) and the `STAGING_TEST_JWT` secrets note (around line 331). In the checklist around line 286, replace the `STAGING_TEST=1 npm test` line and its "Login with staging account" sub-item with:

```markdown
- [ ] `npm test` — all green (unit)
- [ ] Manual production smoke test (§6) — all seven steps pass
```

In the file list at 361-363, delete the `tests/integration/staging.test.js` entry, and change "CI workflow: unit on every push, staging on PR" to "CI workflow: unit tests on every push".

- [ ] **Step 3: Update `00-README.md`**

Line 24: change "unit, integration against staging, golden-replay of prod uploads" to "unit tests, plus a manual smoke test against production".

Line 39 (status board row 08): replace the row with:

```markdown
| 08 | [[08-testing-strategy]] | ✅ written | 🟡 unit tests landed (373 tests); prod smoke test blocked on Kong routes |
```

Line 67 (the "Pending" line in the exit-criteria callout): replace with:

```markdown
> **Pending**: manual production smoke test via the environment switch
> (blocked on Kong routes), then version bump + GH Actions release per
> CLAUDE.md sequence. Staging was dropped as a test target — it shares the
> prod DB, runs no sidekiq and has no dedicated opensearch indexes, so
> uploads there are never properly saved.
```

- [ ] **Step 4: Update the two remaining references**

`docs/plans/05-upload-flow.md:330` — change "Config → set backend to staging, log in with test account" to "Header switch → select Production, log in with a test account".

`docs/plans/06-my-uploads-integration.md:249` — change "Manual smoke on staging (golden replay in [[08-testing-strategy]])" to "Manual smoke on production (procedure in [[08-testing-strategy]] §6)".

- [ ] **Step 5: Verify no staging test instructions survive**

Run: `grep -rn "staging" docs/plans/*.md`
Expected: only incidental or historical mentions — for example `02-endpoint-mapping.md:133` ("confirm on staging" about a response shape) and `04-rest-client-refactor.md:326`. **No** remaining instruction to run tests or smoke tests against staging. Fix any that remain.

- [ ] **Step 6: Commit**

```bash
git add docs/plans/
git commit -m "docs: replace the staging smoke test with a production procedure

Staging runs against the prod DB with no sidekiq and no dedicated
opensearch indexes, so uploads there are never properly saved or indexed.
Production is the honest target; test uploads stay traceable by source,
date and the v2.0.0 user-agent. Blocked on Kong routes."
```

---

### Task 9: Rewrite the README

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Read the current README to salvage what is still true**

Run: `cat README.md`

Keep the feature descriptions, supported formats, browser compatibility, project structure and acknowledgements, adjusting details that changed. Replace everything describing the API, configuration, versions or branding.

- [ ] **Step 2: Write the new README**

Required sections, in order:

1. **Title** — "OpenSubtitles Uploader" (the "PRO" branding was dropped in ui-step-1). Version badge reads 2.0.0 and links to `opensubtitles-dev/opensubtitles-com-uploader/releases`.
2. **What it is** — desktop and web uploader targeting the opensubtitles.com REST API.
3. **Downloads** — this fork's releases page.
4. **Features** — carried over.
5. **Prerequisites** — Node 18+, npm; Rust toolchain and platform dependencies for desktop builds (carry over the existing list).
6. **Install**
   ```bash
   git clone git@github.com:opensubtitles-dev/opensubtitles-com-uploader.git
   cd opensubtitles-com-uploader
   npm install
   cp .env.example .env   # then fill in the keys
   ```
7. **Configuration** — the four variables, mirroring `.env.example`: `VITE_OPENSUBTITLES_API_KEY_PROD`, `VITE_OPENSUBTITLES_API_KEY_DEV`, `VITE_OPENSUBTITLES_BASE_URL`, `VITE_ENV_SWITCH`. State plainly that production is hard-wired and only the dev URL is configurable.
8. **Running**
   ```bash
   npm run dev                       # web, switch per .env
   VITE_ENV_SWITCH=true npm run dev  # force the switch on
   npm run tauri:dev                 # desktop
   ```
9. **The environment switch** — what it is; that it appears only in builds made with `VITE_ENV_SWITCH=true`; that switching reloads the app; that sessions and caches are per-environment so a login on one does not carry to the other; and that public builds ignore any stored preference.
10. **Building**
    ```bash
    # Tester build — switch visible, both keys embedded
    VITE_ENV_SWITCH=true npm run tauri:build

    # Public build — production only, no switch
    npm run tauri:build
    ```
    Warn that `npm run build` regenerates the changelog from this fork's GitHub releases and will empty `CHANGELOG.md` until the fork has published releases; use `npx vite build` for a plain web build meanwhile.
11. **Testing**
    ```bash
    npm test              # unit suite (node --test)
    npm run lint
    npm run format:check
    ```
    Then the production smoke-test procedure, cross-referencing `docs/plans/08-testing-strategy.md` §6, noting it is blocked on Kong routes.
12. **Releases** — the mandatory sequence from CLAUDE.md: `npm run update-version` → `npm run generate-changelog` → commit → tag → `gh workflow run "Build Desktop Apps" --field create_release=true`.
13. **Project structure** — carried over, adding `src/config/environments.js`.
14. **Security** — never commit `.env`; keys are embedded at build time; never log tokens or session ids (point at `src/utils/securityUtils.js`).
15. **Contributing / License / Support** — carried over with fork URLs.

Every GitHub URL must use `opensubtitles-dev/opensubtitles-com-uploader`. Do not reintroduce `opensubtitles/opensubtitles-uploader-pro` — that is upstream.

- [ ] **Step 3: Verify no stale references**

Run: `grep -n "opensubtitles-uploader-pro\|1\.8\.\|staging\|XML-RPC" README.md`
Expected: no matches other than binary filenames such as `opensubtitles-uploader-pro_2.0.0_amd64.AppImage`, which come from the crate name and are correct.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for 2.0.0

Covers the two-environment setup, the header switch, tester vs public
builds, the test suite and the production smoke test. Drops the PRO
branding and the pre-2.0 single-backend instructions."
```

---

### Task 10: Final verification

**Files:** none — verification only.

- [ ] **Step 1: Full suite**

Run: `npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: `fail 0`

- [ ] **Step 2: Formatting**

Run: `npx prettier --check $(git diff --name-only main...HEAD | grep -E '\.(js|jsx|json|css)$' | tr '\n' ' ')`
Expected: "All matched files use Prettier code style!"

- [ ] **Step 3: Lint has not regressed**

Run: `npm run lint 2>&1 | tail -3`
Expected: the error count is **no higher** than the pre-existing 39. New files must contribute zero errors.

- [ ] **Step 4: Both build profiles**

Run: `npx vite build 2>&1 | tail -2` then `VITE_ENV_SWITCH=true npx vite build 2>&1 | tail -2`
Expected: both `✓ built`

- [ ] **Step 5: Nothing left untracked**

Every new file must be committed — a file imported but never staged is exactly the bug that broke this branch before (fixed in `e643783`).

Run: `git status --short`
Expected: no untracked files under `src/` or `tests/`.

- [ ] **Step 6: Restore generated churn**

Run: `git checkout -- src/utils/embeddedConstants.js CHANGELOG.md src/data/changelog.json 2>/dev/null; git status --short`
Expected: a clean tree apart from untracked tooling directories.

- [ ] **Step 7: Report**

Summarize for the user: what shipped; the deviations from the spec (see "Deviations" above); the `CACHE_KEYS.XMLRPC_CHECKSUB` dead-reference observation; and that the production smoke test remains blocked on Kong routes.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §4.1 registry, gating invariant, first-run default | Task 2 |
| §4.2 constants wiring, `validateApiConfiguration` | Task 3 |
| §4.3 scoped keys | Task 4 (widened — see Deviations) |
| §4.3 one-shot purge | Task 5 |
| §4.4 build wiring, two keys, legacy dev-only fallback | Task 6 |
| §4.5 UI component | Task 7 |
| §5 data flow | Verified in Task 7 Step 3 |
| §6 error handling | Tasks 2 (resolution, unselectable dev), 3 (missing key) |
| §7 plan-doc rewrite | Task 8 |
| §8 testing | Tasks 2, 3, 4, 5 |
| §9 `.env.example` | Task 6 Step 8 |
| §9 README | Task 9 |
| §10 acceptance criteria | Task 10 |

Spec §4.3's `scopedKey()` helper is deliberately **not** implemented; the builder functions replace it, for the reason given under Deviations. The spec will be amended.

**Type consistency:** `getActiveEnvironmentId` / `getActiveEnvironment` / `listSelectableEnvironments` / `setActiveEnvironment` / `resolveEnvironmentId` / `buildSelectableList` / `BACKEND_PREF_KEY` / `SWITCH_ENABLED` are used with identical names and signatures across Tasks 2, 3, 4 and 7. `buildStorageKeys` / `buildCachePrefixes` (Task 4, `storageKeys.js`) and `buildCacheKeys` (Task 4, `constants.js`) match between implementation and tests. `purgeUnscopedKeys` (Task 5) matches across implementation, test and `main.jsx`.

**Ordering:** Task 1 must precede Task 2 (import cycle). Task 2 must precede 3, 4 and 7. Task 4 must precede 5 (`MIGRATION_V3_DONE` and `STORAGE_KEYS`). Tasks 8 and 9 are independent of the code and may run any time after Task 7.
