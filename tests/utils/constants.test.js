/**
 * Tests for the API base URL normalization. The contract is documented in
 * .env.example and constants.js — this file locks the behavior so a typo in
 * VITE_OPENSUBTITLES_BASE_URL doesn't silently break the dev/staging swap.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, DEFAULT_BASE_URL } from '../../src/utils/constants.js';

describe('normalizeBaseUrl', () => {
  test('returns DEFAULT_BASE_URL for null / undefined / non-string', () => {
    assert.equal(normalizeBaseUrl(null), DEFAULT_BASE_URL);
    assert.equal(normalizeBaseUrl(undefined), DEFAULT_BASE_URL);
    assert.equal(normalizeBaseUrl(42), DEFAULT_BASE_URL);
    assert.equal(normalizeBaseUrl({}), DEFAULT_BASE_URL);
  });

  test('returns DEFAULT_BASE_URL for empty / whitespace string', () => {
    assert.equal(normalizeBaseUrl(''), DEFAULT_BASE_URL);
    assert.equal(normalizeBaseUrl('   '), DEFAULT_BASE_URL);
    assert.equal(normalizeBaseUrl('\t\n'), DEFAULT_BASE_URL);
  });

  test('appends /api/v1 when no /api/vN suffix present', () => {
    assert.equal(normalizeBaseUrl('http://localhost:3001'), 'http://localhost:3001/api/v1');
    assert.equal(
      normalizeBaseUrl('https://staging.opensubtitles.com'),
      'https://staging.opensubtitles.com/api/v1'
    );
    assert.equal(normalizeBaseUrl('https://osdev.ngrok.dev'), 'https://osdev.ngrok.dev/api/v1');
  });

  test('preserves an existing /api/vN suffix', () => {
    assert.equal(normalizeBaseUrl('http://localhost:3001/api/v1'), 'http://localhost:3001/api/v1');
    assert.equal(normalizeBaseUrl('https://x.com/api/v2'), 'https://x.com/api/v2');
    assert.equal(normalizeBaseUrl('https://x.com/api/v10'), 'https://x.com/api/v10');
  });

  test('strips trailing slash(es)', () => {
    assert.equal(normalizeBaseUrl('http://localhost:3001/'), 'http://localhost:3001/api/v1');
    assert.equal(normalizeBaseUrl('http://localhost:3001//'), 'http://localhost:3001/api/v1');
    assert.equal(normalizeBaseUrl('http://localhost:3001/api/v1/'), 'http://localhost:3001/api/v1');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(
      normalizeBaseUrl('  http://localhost:3001/api/v1  '),
      'http://localhost:3001/api/v1'
    );
  });

  test('default is the production .com URL', () => {
    assert.equal(DEFAULT_BASE_URL, 'https://api.opensubtitles.com/api/v1');
  });

  test('partial /api path without version is treated as bare host', () => {
    // 'foo.com/api' is unusual but should get the /v1 appended (becomes /api/api/v1)
    // Document the actual behavior so future changes are intentional.
    assert.equal(normalizeBaseUrl('https://foo.com/api'), 'https://foo.com/api/api/v1');
  });
});

import { getActiveEnvironment, getActiveEnvironmentId } from '../../src/config/environments.js';
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

import { buildCacheKeys, CACHE_KEYS } from '../../src/utils/constants.js';

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

  test('the exported CACHE_KEYS singleton reflects the active environment', () => {
    // Guards the wiring line itself (constants.js: `export const CACHE_KEYS =
    // buildCacheKeys(getActiveEnvironmentId())`), not just the builder: if
    // that line were ever hardcoded to a literal environment id, or lost its
    // scoping in a bad merge, dev and prod would silently collapse onto the
    // same cache keys while every other assertion in this block (which only
    // exercises the builder directly, not the exported singleton) would
    // keep passing.
    assert.deepEqual(CACHE_KEYS, buildCacheKeys(getActiveEnvironmentId()));
  });
});

import { STRIP_URLS_DEFAULT, isLinkRemovalEnabled } from '../../src/utils/constants.js';

/**
 * Link removal has three stored states so that its default can be changed
 * after release: an explicit true/false is the user's choice and always wins;
 * anything else means "never chosen" and follows STRIP_URLS_DEFAULT.
 */
describe('link removal default', () => {
  test('ships off, matching upstream', () => {
    assert.equal(STRIP_URLS_DEFAULT, false);
  });

  test('an explicit choice wins over the default, either way', () => {
    assert.equal(isLinkRemovalEnabled({ stripUrls: true }), true);
    assert.equal(isLinkRemovalEnabled({ stripUrls: false }), false);
  });

  test('never-chosen follows the default', () => {
    assert.equal(isLinkRemovalEnabled({ stripUrls: null }), STRIP_URLS_DEFAULT);
    assert.equal(isLinkRemovalEnabled({}), STRIP_URLS_DEFAULT);
    assert.equal(isLinkRemovalEnabled(undefined), STRIP_URLS_DEFAULT);
  });

  test('a stray non-boolean is not mistaken for a choice', () => {
    assert.equal(isLinkRemovalEnabled({ stripUrls: 'true' }), STRIP_URLS_DEFAULT);
    assert.equal(isLinkRemovalEnabled({ stripUrls: 1 }), STRIP_URLS_DEFAULT);
  });
});
