/**
 * Tests for the features REST service.
 *
 * Uses `createFeaturesApi({ client, cache })` to avoid loading the real
 * CacheService (which depends on `pako` from node_modules).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFeaturesApi,
  imdbIdToNumeric,
  normalizeFeatureForUi,
  normalizeFeaturesResponse,
} from '../../../src/services/api/features.js';

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
    loadFromCache(k) {
      return store.has(k) ? store.get(k) : null;
    },
    saveToCache(k, d /* , ctl */) {
      store.set(k, d);
      return { success: true };
    },
    clearCache(k) {
      store.delete(k);
    },
  };
}

const matrixFeature = {
  id: '646193',
  type: 'feature',
  attributes: {
    title: 'the matrix',
    original_title: 'The Matrix',
    year: '1999',
    feature_type: 'Movie',
    feature_id: '646193',
    imdb_id: 133093,
    tmdb_id: 603,
    parent_imdb_id: null,
    img_url: 'https://example.com/img.jpg',
    url: 'https://www.opensubtitles.com/en/movies/1999-the-matrix',
  },
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('imdbIdToNumeric', () => {
  test('strips tt prefix and leading zeros', () => {
    assert.equal(imdbIdToNumeric('tt0133093'), '133093');
    assert.equal(imdbIdToNumeric('tt1133589'), '1133589');
    assert.equal(imdbIdToNumeric('tt0000001'), '1');
  });

  test('passes through plain numeric strings', () => {
    assert.equal(imdbIdToNumeric('133093'), '133093');
    assert.equal(imdbIdToNumeric('0133093'), '133093');
  });

  test('coerces numeric input to string', () => {
    assert.equal(imdbIdToNumeric(133093), '133093');
  });

  test('handles edge cases', () => {
    assert.equal(imdbIdToNumeric(null), '');
    assert.equal(imdbIdToNumeric(undefined), '');
    assert.equal(imdbIdToNumeric(''), '');
    assert.equal(imdbIdToNumeric('  tt0133093  '), '133093');
    assert.equal(imdbIdToNumeric('TT0133093'), '133093');
  });
});

describe('normalizeFeatureForUi', () => {
  test('produces both legacy and new-shape fields', () => {
    const r = normalizeFeatureForUi(matrixFeature);
    // legacy
    assert.equal(r.id, 'tt0133093');
    assert.equal(r.name, 'The Matrix');
    assert.equal(r.year, 1999);
    assert.equal(r.kind, 'movie');
    // new
    assert.equal(r.feature_id, 646193);
    assert.equal(r.imdb_id, 133093);
    assert.equal(r.tmdb_id, 603);
    assert.equal(r.original_title, 'The Matrix');
    assert.equal(r.title, 'the matrix');
    assert.equal(r.img_url, 'https://example.com/img.jpg');
  });

  test('handles missing imdb_id', () => {
    const r = normalizeFeatureForUi({
      id: '99',
      attributes: { original_title: 'X', year: '2024', feature_type: 'Movie' },
    });
    assert.equal(r.id, '');
    assert.equal(r.imdb_id, null);
    assert.equal(r.feature_id, 99);
  });

  test('falls back to title when original_title missing', () => {
    const r = normalizeFeatureForUi({
      id: '1',
      attributes: { title: 'lower title' },
    });
    assert.equal(r.name, 'lower title');
  });

  test('handles malformed input', () => {
    assert.deepEqual(normalizeFeatureForUi(null).id, '');
    assert.deepEqual(normalizeFeatureForUi({}).id, '');
    assert.deepEqual(normalizeFeatureForUi({ attributes: {} }).id, '');
  });

  test('lowercases feature_type for kind', () => {
    const r1 = normalizeFeatureForUi({ attributes: { feature_type: 'Tvshow' } });
    const r2 = normalizeFeatureForUi({ attributes: { feature_type: 'EPISODE' } });
    assert.equal(r1.kind, 'tvshow');
    assert.equal(r2.kind, 'episode');
  });

  test('preserves season/episode numbers when present', () => {
    const r = normalizeFeatureForUi({
      attributes: { season_number: 4, episode_number: 4, feature_type: 'Episode' },
    });
    assert.equal(r.season_number, 4);
    assert.equal(r.episode_number, 4);
  });

  test('pads short imdb_id to 7 digits', () => {
    const r = normalizeFeatureForUi({ attributes: { imdb_id: 1234 } });
    assert.equal(r.id, 'tt0001234');
  });
});

describe('normalizeFeaturesResponse', () => {
  test('maps each item through normalizeFeatureForUi', () => {
    const out = normalizeFeaturesResponse({ data: [matrixFeature] });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'tt0133093');
  });

  test('returns [] for malformed payloads', () => {
    assert.deepEqual(normalizeFeaturesResponse(null), []);
    assert.deepEqual(normalizeFeaturesResponse({}), []);
    assert.deepEqual(normalizeFeaturesResponse({ data: null }), []);
    assert.deepEqual(normalizeFeaturesResponse({ data: 'nope' }), []);
  });
});

// ---------------------------------------------------------------------------
// searchByQuery
// ---------------------------------------------------------------------------

describe('featuresApi.searchByQuery', () => {
  let cache;
  beforeEach(() => {
    cache = makeFakeCache();
  });

  test('returns [] for empty / whitespace query without hitting network', async () => {
    let called = 0;
    const client = makeFakeClient(async () => {
      called += 1;
      return { data: [] };
    });
    const api = createFeaturesApi({ client, cache });

    const r1 = await api.searchByQuery('');
    const r2 = await api.searchByQuery('   ');
    const r3 = await api.searchByQuery(null);
    assert.equal(called, 0);
    assert.deepEqual(r1.data, []);
    assert.deepEqual(r2.data, []);
    assert.deepEqual(r3.data, []);
  });

  test('hits /features?query=... with trimmed query and authenticated:false', async () => {
    const client = makeFakeClient(async () => ({ data: [matrixFeature] }));
    const api = createFeaturesApi({ client, cache });

    await api.searchByQuery('  matrix  ');
    assert.equal(client.calls[0].path, '/features');
    assert.equal(client.calls[0].opts.query.query, 'matrix');
    assert.equal(client.calls[0].opts.authenticated, false);
  });

  test('passes type filter when provided', async () => {
    const client = makeFakeClient(async () => ({ data: [] }));
    const api = createFeaturesApi({ client, cache });

    await api.searchByQuery('matrix', { type: 'episode' });
    assert.equal(client.calls[0].opts.query.type, 'episode');
  });

  test('caches result by lowercased query + type', async () => {
    let called = 0;
    const client = makeFakeClient(async () => {
      called += 1;
      return { data: [matrixFeature] };
    });
    const api = createFeaturesApi({ client, cache });

    await api.searchByQuery('Matrix');
    const second = await api.searchByQuery('matrix'); // case-insensitive
    assert.equal(called, 1);
    assert.equal(second.fromCache, true);
  });

  test('different type yields different cache entry', async () => {
    let called = 0;
    const client = makeFakeClient(async () => {
      called += 1;
      return { data: [matrixFeature] };
    });
    const api = createFeaturesApi({ client, cache });

    await api.searchByQuery('matrix');
    await api.searchByQuery('matrix', { type: 'movie' });
    assert.equal(called, 2);
  });

  test('returns normalized data', async () => {
    const client = makeFakeClient(async () => ({ data: [matrixFeature] }));
    const api = createFeaturesApi({ client, cache });

    const { data } = await api.searchByQuery('matrix');
    assert.equal(data[0].id, 'tt0133093');
    assert.equal(data[0].feature_id, 646193);
  });
});

// ---------------------------------------------------------------------------
// byImdbId
// ---------------------------------------------------------------------------

describe('featuresApi.byImdbId', () => {
  let cache;
  beforeEach(() => {
    cache = makeFakeCache();
  });

  test('strips tt prefix before sending', async () => {
    const client = makeFakeClient(async () => ({ data: [matrixFeature] }));
    const api = createFeaturesApi({ client, cache });

    await api.byImdbId('tt0133093');
    assert.equal(client.calls[0].opts.query.imdb_id, '133093');
  });

  test('accepts numeric input', async () => {
    const client = makeFakeClient(async () => ({ data: [matrixFeature] }));
    const api = createFeaturesApi({ client, cache });

    await api.byImdbId(133093);
    assert.equal(client.calls[0].opts.query.imdb_id, '133093');
  });

  test('returns [] for empty / null id without hitting network', async () => {
    let called = 0;
    const client = makeFakeClient(async () => {
      called += 1;
      return { data: [] };
    });
    const api = createFeaturesApi({ client, cache });

    await api.byImdbId('');
    await api.byImdbId(null);
    await api.byImdbId('tt0');
    assert.equal(called, 0);
  });

  test('caches per IMDB id', async () => {
    let called = 0;
    const client = makeFakeClient(async () => {
      called += 1;
      return { data: [matrixFeature] };
    });
    const api = createFeaturesApi({ client, cache });

    await api.byImdbId('tt0133093');
    const second = await api.byImdbId('133093');
    assert.equal(called, 1);
    assert.equal(second.fromCache, true);
  });

  test('uses authenticated:false', async () => {
    const client = makeFakeClient(async () => ({ data: [] }));
    const api = createFeaturesApi({ client, cache });
    await api.byImdbId('tt0133093');
    assert.equal(client.calls[0].opts.authenticated, false);
  });
});

// ---------------------------------------------------------------------------
// Cache without cache backend
// ---------------------------------------------------------------------------

describe('featuresApi without cache backend', () => {
  test('still works (just no caching)', async () => {
    let called = 0;
    const client = makeFakeClient(async () => {
      called += 1;
      return { data: [matrixFeature] };
    });
    const api = createFeaturesApi({ client });
    await api.searchByQuery('matrix');
    await api.searchByQuery('matrix');
    assert.equal(called, 2);
  });
});
