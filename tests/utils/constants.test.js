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
