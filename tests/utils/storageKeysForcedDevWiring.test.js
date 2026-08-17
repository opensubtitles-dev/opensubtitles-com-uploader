/**
 * Forced-environment test for the module-load WIRING lines in
 * storageKeys.js and constants.js:
 *
 *   export const STORAGE_KEYS   = buildStorageKeys(getActiveEnvironmentId());
 *   export const CACHE_PREFIXES = buildCachePrefixes(getActiveEnvironmentId());
 *   export const CACHE_KEYS     = buildCacheKeys(getActiveEnvironmentId());
 *
 * Every other test that touches these exports runs under plain
 * `node --test`, where SWITCH_ENABLED is always false (no Vite `define`,
 * no VITE_ENV_SWITCH), so getActiveEnvironmentId() always resolves to
 * 'prod'. That makes a wiring line hardcoded to buildStorageKeys('prod')
 * behave IDENTICALLY to the correct one under those tests — an assertion
 * of the form `deepEqual(SINGLETON, builder(getActiveEnvironmentId()))`
 * cannot distinguish them there, because both sides evaluate to the exact
 * same 'prod'-scoped value.
 *
 * This file closes that gap by forcing the active environment to 'dev'
 * BEFORE a fresh copy of the modules is imported, so a 'prod'-hardcoded
 * wiring line produces an observably WRONG value
 * ('osdb_com_prod_jwt' instead of 'osdb_com_dev_jwt').
 *
 * How the forcing works:
 *  - storageKeys.js/constants.js resolve the active env via
 *    getActiveEnvironmentId(storage), which reads:
 *      1. SWITCH_ENABLED — true when `typeof __ENV_SWITCH_ENABLED__ !==
 *         'undefined' && __ENV_SWITCH_ENABLED__ === 'true'`. Under plain
 *         Node this identifier is never declared, so a bare
 *         `globalThis.__ENV_SWITCH_ENABLED__ = 'true'` satisfies the
 *         `typeof` check (unqualified identifiers fall back to the global
 *         object when nothing shadows them in scope).
 *      2. globalThis.localStorage.getItem('osdb_backend') — the stored
 *         preference, honoured only when SWITCH_ENABLED is true.
 *  - Setting both BEFORE importing storageKeys.js/constants.js isn't
 *    enough on its own: ordinary imports are cached by Node's module
 *    loader, so if anything already imported these modules in this
 *    process, the *already-evaluated* singletons would be returned
 *    unchanged. A cache-busted dynamic import
 *    (`import('../../src/utils/storageKeys.js?bust=' + Date.now())`)
 *    gives each run a distinct module specifier, forcing a fresh
 *    evaluation of the module's top-level code — including the wiring
 *    lines under test — against the mocked globals.
 *  - storageKeys.js/constants.js each import '../config/environments.js'
 *    via a fixed (non-busted) relative specifier. Because THIS FILE never
 *    imports environments.js before triggering that fresh evaluation, the
 *    plain specifier gets its first (and only) load at that moment, so it
 *    also picks up the mocked globals — and a later plain import of it
 *    from this file returns that same already-mocked instance.
 *
 * Kept in its own file (rather than folded into storageKeys.test.js /
 * constants.test.js) because `node --test` isolates each test *file* in
 * its own child process, but not each test *within* a file — mutating
 * globalThis.__ENV_SWITCH_ENABLED__ / globalThis.localStorage here must
 * never leak into sibling tests that rely on the real, unmocked
 * singletons. The globals are also explicitly saved and restored in a
 * `finally` block as defence in depth.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('STORAGE_KEYS / CACHE_PREFIXES / CACHE_KEYS wiring, forced to the dev environment', () => {
  test('module-load singletons track a forced dev environment (not just the pure builders)', async () => {
    const hadSwitchGlobal = Object.prototype.hasOwnProperty.call(
      globalThis,
      '__ENV_SWITCH_ENABLED__'
    );
    const originalSwitch = globalThis.__ENV_SWITCH_ENABLED__;
    const hadLocalStorage = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
    const originalLocalStorage = globalThis.localStorage;

    globalThis.__ENV_SWITCH_ENABLED__ = 'true';
    globalThis.localStorage = {
      // 'osdb_backend' mirrors BACKEND_PREF_KEY in config/environments.js.
      // Kept as a literal (not imported) — importing environments.js
      // before these mocks are set would cache it with SWITCH_ENABLED
      // baked in as false, defeating this whole test.
      getItem: key => (key === 'osdb_backend' ? 'dev' : null),
      setItem: () => {},
      removeItem: () => {},
    };

    try {
      const bust = Date.now();
      const storageKeysFresh = await import(`../../src/utils/storageKeys.js?bust=${bust}`);
      const constantsFresh = await import(`../../src/utils/constants.js?bust=${bust}`);
      // Same module record storageKeys.js/constants.js just loaded as a
      // dependency (plain specifier, no bust) — not a new evaluation.
      const envFresh = await import('../../src/config/environments.js');

      assert.equal(
        envFresh.getActiveEnvironmentId(),
        'dev',
        'harness setup failed: forced env did not resolve to dev'
      );

      // Direct, concrete-value checks — the ones a 'prod'-hardcoded wiring
      // line actually fails, since it would produce the wrong literal.
      assert.equal(storageKeysFresh.STORAGE_KEYS.JWT, 'osdb_com_dev_jwt');
      assert.equal(storageKeysFresh.STORAGE_KEYS.USER, 'osdb_com_dev_user');
      assert.equal(storageKeysFresh.STORAGE_KEYS.LOGIN_TIME, 'osdb_com_dev_login_time');
      assert.equal(storageKeysFresh.CACHE_PREFIXES.LANGUAGES, 'rest_dev_languages_cache');
      assert.equal(constantsFresh.CACHE_KEYS.FEATURES_CACHE, 'opensubtitles_dev_features_cache');
      assert.equal(constantsFresh.CACHE_KEYS.GUESSIT_CACHE, 'opensubtitles_dev_guessit_cache');

      // Same shape as the Fix Round 1 wiring assertions, now meaningful
      // because the live resolver no longer coincides with a hardcoded
      // 'prod' default.
      assert.deepEqual(
        storageKeysFresh.STORAGE_KEYS,
        storageKeysFresh.buildStorageKeys(envFresh.getActiveEnvironmentId())
      );
      assert.deepEqual(
        storageKeysFresh.CACHE_PREFIXES,
        storageKeysFresh.buildCachePrefixes(envFresh.getActiveEnvironmentId())
      );
      assert.deepEqual(
        constantsFresh.CACHE_KEYS,
        constantsFresh.buildCacheKeys(envFresh.getActiveEnvironmentId())
      );
    } finally {
      if (hadSwitchGlobal) {
        globalThis.__ENV_SWITCH_ENABLED__ = originalSwitch;
      } else {
        delete globalThis.__ENV_SWITCH_ENABLED__;
      }
      if (hadLocalStorage) {
        globalThis.localStorage = originalLocalStorage;
      } else {
        delete globalThis.localStorage;
      }
    }
  });
});
