import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEYS,
  CACHE_PREFIXES,
  LEGACY_KEYS,
  migrateLegacyKeys,
  purgeUnscopedKeys,
} from '../../src/utils/storageKeys.js';

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
  has(k) {
    return this._m.has(k);
  }
  size() {
    return this._m.size;
  }
  key(i) {
    return Array.from(this._m.keys())[i] ?? null;
  }
  get length() {
    return this._m.size;
  }
}

describe('STORAGE_KEYS / CACHE_PREFIXES / LEGACY_KEYS', () => {
  test('STORAGE_KEYS uses osdb_com_ prefix for new auth keys', () => {
    assert.match(STORAGE_KEYS.JWT, /^osdb_com_/);
    assert.match(STORAGE_KEYS.USER, /^osdb_com_/);
    assert.match(STORAGE_KEYS.LOGIN_TIME, /^osdb_com_/);
    assert.match(STORAGE_KEYS.MIGRATION_V2_DONE, /^osdb_/);
    assert.match(STORAGE_KEYS.BACKEND_PREF, /^osdb_/);
  });

  test('CACHE_PREFIXES use rest_ namespace', () => {
    for (const v of Object.values(CACHE_PREFIXES)) {
      assert.match(v, /^rest_/);
    }
  });

  test('LEGACY_KEYS contains every opensubtitles_* key the migration must purge', () => {
    assert.ok(LEGACY_KEYS.includes('opensubtitles_token'));
    assert.ok(LEGACY_KEYS.includes('opensubtitles_user_data'));
    assert.ok(LEGACY_KEYS.includes('opensubtitles_login_time'));
    assert.ok(LEGACY_KEYS.includes('opensubtitles_session_id'));
    assert.ok(LEGACY_KEYS.includes('opensubtitles_xmlrpc_languages_cache'));
    assert.ok(LEGACY_KEYS.includes('opensubtitles_xmlrpc_checksub_cache'));
  });

  test('STORAGE_KEYS object is frozen (cannot be mutated by callers)', () => {
    assert.throws(() => {
      STORAGE_KEYS.JWT = 'hijack';
    }, /Cannot assign to read only property|object is not extensible|Cannot add property/);
  });
});

describe('migrateLegacyKeys', () => {
  let storage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  test('removes every legacy key on first call', () => {
    LEGACY_KEYS.forEach(k => storage.setItem(k, 'stale'));
    assert.equal(storage.size(), LEGACY_KEYS.length);

    const ran = migrateLegacyKeys(storage);
    assert.equal(ran, true);

    for (const key of LEGACY_KEYS) {
      assert.equal(storage.getItem(key), null, `expected ${key} removed`);
    }
  });

  test('sets the migration marker after running', () => {
    migrateLegacyKeys(storage);
    assert.equal(storage.getItem(STORAGE_KEYS.MIGRATION_V2_DONE), '1');
  });

  test('is idempotent — second call is a no-op', () => {
    storage.setItem('opensubtitles_token', 'first');
    migrateLegacyKeys(storage);
    storage.setItem('opensubtitles_token', 'snuck-back-in');
    const ran = migrateLegacyKeys(storage);
    assert.equal(ran, false);
    assert.equal(storage.getItem('opensubtitles_token'), 'snuck-back-in');
  });

  test('does not touch non-legacy keys', () => {
    storage.setItem('opensubtitles_token', 'stale');
    storage.setItem('opensubtitles_remembered_username', 'alice');
    storage.setItem('osdb_com_jwt', 'eyJ...');
    storage.setItem('rest_languages_cache', '[]');

    migrateLegacyKeys(storage);

    assert.equal(storage.getItem('opensubtitles_remembered_username'), 'alice');
    assert.equal(storage.getItem('osdb_com_jwt'), 'eyJ...');
    assert.equal(storage.getItem('rest_languages_cache'), '[]');
    assert.equal(storage.getItem('opensubtitles_token'), null);
  });

  test('returns false when no storage available', () => {
    const ran = migrateLegacyKeys(null);
    assert.equal(ran, false);
  });

  test('does not throw if individual removeItem throws', () => {
    const broken = {
      _calls: 0,
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('quota');
      },
    };
    assert.doesNotThrow(() => migrateLegacyKeys(broken));
  });
});

import { buildStorageKeys, buildCachePrefixes } from '../../src/utils/storageKeys.js';
import { getActiveEnvironmentId } from '../../src/config/environments.js';

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

  test('the exported STORAGE_KEYS and CACHE_PREFIXES singletons reflect the active environment', () => {
    // Guards the wiring itself, not just the builders: if STORAGE_KEYS or
    // CACHE_PREFIXES were ever hardcoded to a literal environment (or lost
    // their scoping in a bad merge), dev and prod would silently collapse
    // onto the same storage keys — the exact failure this task exists to
    // prevent — while every other assertion in this file (which only checks
    // prefix shape, not the live envId) would keep passing.
    assert.deepEqual(STORAGE_KEYS, buildStorageKeys(getActiveEnvironmentId()));
    assert.deepEqual(CACHE_PREFIXES, buildCachePrefixes(getActiveEnvironmentId()));
  });
});

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
