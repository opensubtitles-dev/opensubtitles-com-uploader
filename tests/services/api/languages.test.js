/**
 * Tests for the languages REST service.
 *
 * Uses `createLanguagesApi({ client, cache })` so we never load the real
 * CacheService (which depends on `pako` from node_modules).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLanguagesApi,
  normalizeLanguagesResponse,
} from '../../../src/services/api/languages.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeClient(handler) {
  const calls = [];
  return {
    calls,
    async get(path, opts) {
      calls.push({ path, opts });
      return handler(path, opts);
    },
  };
}

function makeFakeCache() {
  const store = new Map();
  return {
    store,
    loadFromCache(key) {
      return store.has(key) ? store.get(key) : null;
    },
    saveToCache(key, data /* , cacheControl */) {
      store.set(key, data);
      return { success: true };
    },
    clearCache(key) {
      store.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Pure normalizer
// ---------------------------------------------------------------------------

describe('normalizeLanguagesResponse', () => {
  test('lowercases and dedupes language_code', () => {
    const input = {
      data: [
        { language_code: 'ENG', language_name: 'English' },
        { language_code: 'eng', language_name: 'English (dup)' },
        { language_code: 'fre', language_name: 'French' },
      ],
    };
    assert.deepEqual(normalizeLanguagesResponse(input), [
      { language_code: 'eng', language_name: 'English' },
      { language_code: 'fre', language_name: 'French' },
    ]);
  });

  test('drops entries with missing or blank language_code', () => {
    const input = {
      data: [
        { language_name: 'Nameless' },
        { language_code: '', language_name: 'Empty' },
        { language_code: 'eng', language_name: 'English' },
      ],
    };
    assert.deepEqual(normalizeLanguagesResponse(input), [
      { language_code: 'eng', language_name: 'English' },
    ]);
  });

  test('returns [] when data is not an array', () => {
    assert.deepEqual(normalizeLanguagesResponse({ data: null }), []);
    assert.deepEqual(normalizeLanguagesResponse({}), []);
    assert.deepEqual(normalizeLanguagesResponse(null), []);
    assert.deepEqual(normalizeLanguagesResponse(undefined), []);
  });

  test('handles missing language_name gracefully', () => {
    const input = { data: [{ language_code: 'eng' }] };
    assert.deepEqual(normalizeLanguagesResponse(input), [
      { language_code: 'eng', language_name: '' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// list() — happy paths + caching + auth
// ---------------------------------------------------------------------------

describe('languagesApi.list', () => {
  let cache;
  beforeEach(() => {
    cache = makeFakeCache();
  });

  test('hits /infos/languages with authenticated:false', async () => {
    const client = makeFakeClient(async () => ({
      data: [{ language_code: 'eng', language_name: 'English' }],
    }));
    const api = createLanguagesApi({ client, cache });

    await api.list();
    assert.equal(client.calls[0].path, '/infos/languages');
    assert.equal(client.calls[0].opts.authenticated, false);
  });

  test('returns normalized list on first call (fromCache: false)', async () => {
    const client = makeFakeClient(async () => ({
      data: [
        { language_code: 'ENG', language_name: 'English' },
        { language_code: 'fre', language_name: 'French' },
      ],
    }));
    const api = createLanguagesApi({ client, cache });

    const r = await api.list();
    assert.equal(r.fromCache, false);
    assert.deepEqual(r.data, [
      { language_code: 'eng', language_name: 'English' },
      { language_code: 'fre', language_name: 'French' },
    ]);
  });

  test('writes the normalized list to cache', async () => {
    const client = makeFakeClient(async () => ({
      data: [{ language_code: 'eng', language_name: 'English' }],
    }));
    const api = createLanguagesApi({ client, cache });

    await api.list();
    const cached = cache.loadFromCache('rest_languages_cache');
    assert.deepEqual(cached, [{ language_code: 'eng', language_name: 'English' }]);
  });

  test('second call returns from cache without hitting the network', async () => {
    let calls = 0;
    const client = makeFakeClient(async () => {
      calls += 1;
      return { data: [{ language_code: 'eng', language_name: 'English' }] };
    });
    const api = createLanguagesApi({ client, cache });

    await api.list();
    const second = await api.list();
    assert.equal(calls, 1);
    assert.equal(second.fromCache, true);
    assert.deepEqual(second.data, [{ language_code: 'eng', language_name: 'English' }]);
  });

  test('_clearCache forces a fresh fetch', async () => {
    let calls = 0;
    const client = makeFakeClient(async () => {
      calls += 1;
      return { data: [{ language_code: 'eng', language_name: 'English' }] };
    });
    const api = createLanguagesApi({ client, cache });

    await api.list();
    api._clearCache();
    const second = await api.list();
    assert.equal(calls, 2);
    assert.equal(second.fromCache, false);
  });

  test('works without cache at all (cache: undefined)', async () => {
    let calls = 0;
    const client = makeFakeClient(async () => {
      calls += 1;
      return { data: [{ language_code: 'eng', language_name: 'English' }] };
    });
    const api = createLanguagesApi({ client });

    await api.list();
    await api.list();
    assert.equal(calls, 2);
  });

  test('propagates errors from the client', async () => {
    const client = makeFakeClient(async () => {
      throw new Error('boom');
    });
    const api = createLanguagesApi({ client, cache });
    await assert.rejects(() => api.list(), /boom/);
  });

  test('does not write to cache when client throws', async () => {
    const client = makeFakeClient(async () => {
      throw new Error('boom');
    });
    const api = createLanguagesApi({ client, cache });
    await assert.rejects(() => api.list());
    assert.equal(cache.loadFromCache('rest_languages_cache'), null);
  });
});
