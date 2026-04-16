/**
 * Tests for the errorCopy() helper. We don't render React in this test
 * harness — the COPY mapping is the part most likely to drift from the
 * server-side error_code list, so we lock that down here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// Imported from the pure .js helper (extracted from ErrorBanner.jsx so we
// can test without a JSX loader).
import { errorCopy } from '../../src/utils/errorCopy.js';

describe('errorCopy', () => {
  test('returns null for falsy error', () => {
    assert.equal(errorCopy(null), null);
    assert.equal(errorCopy(undefined), null);
  });

  test('maps known REST error_code to title + body', () => {
    const r = errorCopy({ code: 'quota_exceeded' });
    assert.equal(r.code, 'quota_exceeded');
    assert.match(r.title, /limit/i);
  });

  test('falls back to error.message for codes without specific copy', () => {
    const r = errorCopy({ code: 'http_418', message: "I'm a teapot" });
    assert.equal(r.code, 'http_418');
    assert.match(r.title, /something went wrong/i); // unknown title
    assert.equal(r.body, "I'm a teapot");
  });

  test('synthesizes code from HTTP status when error.code missing', () => {
    const r = errorCopy({ status: 503 });
    assert.equal(r.code, 'http_503');
  });

  test('handles every plan-listed code without throwing', () => {
    const codes = [
      'offline', 'network_error', 'timeout', 'server_error',
      'unauthorized', 'banned', 'quota_exceeded', 'duplicate',
      'spam_filename', 'spam_content', 'anon_duplicate_language',
      'feature_not_found', 'invalid_language', 'invalid_content',
      'invalid_type', 'subhash_mismatch', 'validation_error',
      'missing_title', 'not_found', 'unknown',
    ];
    for (const code of codes) {
      const r = errorCopy({ code });
      assert.ok(r.title, `expected title for code ${code}`);
      assert.equal(r.code, code);
    }
  });
});
