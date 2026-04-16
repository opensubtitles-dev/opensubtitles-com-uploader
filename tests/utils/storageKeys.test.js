import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEYS,
  CACHE_PREFIXES,
  LEGACY_KEYS,
  migrateLegacyKeys,
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
