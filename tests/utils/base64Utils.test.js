import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uint8ArrayToBase64 } from '../../src/utils/base64Utils.js';

/**
 * The bug this guards against:
 *
 *   btoa(String.fromCharCode.apply(null, bytes))
 *
 * `apply` passes every byte as a separate function argument, so the engine's
 * argument-count limit caps the input size. V8 throws RangeError somewhere
 * between 64KB and 128KB; WKWebView — which is what the macOS/iOS Tauri builds
 * run — throws at roughly 65k arguments.
 *
 * This ran on zlib-compressed subtitle bytes in the upload path, so a large
 * enough subtitle failed at hash time and could not be uploaded at all.
 */

// Deterministic pseudo-random bytes — compressible data would hide size issues.
const bytes = n => {
  const out = new Uint8Array(n);
  let seed = 42;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = seed & 0xff;
  }
  return out;
};

describe('uint8ArrayToBase64', () => {
  test('encodes an empty array', () => {
    assert.equal(uint8ArrayToBase64(new Uint8Array(0)), '');
  });

  test('matches btoa for a small input', () => {
    const b = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    assert.equal(uint8ArrayToBase64(b), btoa('Hello'));
    assert.equal(uint8ArrayToBase64(b), 'SGVsbG8=');
  });

  test('round-trips through atob', () => {
    const b = bytes(1000);
    const decoded = atob(uint8ArrayToBase64(b));
    assert.equal(decoded.length, b.length);
    for (let i = 0; i < b.length; i++) assert.equal(decoded.charCodeAt(i), b[i]);
  });

  test('handles a plain number array, not just Uint8Array', () => {
    assert.equal(uint8ArrayToBase64([72, 101, 108, 108, 111]), 'SGVsbG8=');
  });

  // --- the regression itself ------------------------------------------------

  test('a 128KB buffer does not throw (the old implementation did)', () => {
    const big = bytes(128 * 1024);
    assert.doesNotThrow(() => uint8ArrayToBase64(big));
  });

  test('a 1MB buffer does not throw', () => {
    assert.doesNotThrow(() => uint8ArrayToBase64(bytes(1024 * 1024)));
  });

  test('large output is byte-exact, not merely non-throwing', () => {
    // Chunking must not corrupt or drop data at the seams.
    const big = bytes(200 * 1024);
    const decoded = atob(uint8ArrayToBase64(big));
    assert.equal(decoded.length, big.length);
    for (let i = 0; i < big.length; i++) {
      if (decoded.charCodeAt(i) !== big[i]) {
        assert.fail(`byte ${i} differs: got ${decoded.charCodeAt(i)}, want ${big[i]}`);
      }
    }
  });

  test('is correct across a chunk boundary', () => {
    // 0x8000 is the chunk size; check either side of it and the boundary itself.
    for (const n of [0x8000 - 1, 0x8000, 0x8000 + 1, 2 * 0x8000 + 7]) {
      const b = bytes(n);
      const decoded = atob(uint8ArrayToBase64(b));
      assert.equal(decoded.length, n, `length wrong at n=${n}`);
      assert.equal(decoded.charCodeAt(n - 1), b[n - 1], `last byte wrong at n=${n}`);
    }
  });

  test('the naive implementation really does throw at this size', () => {
    // Documents why the helper exists. If this ever stops throwing, the engine
    // changed and the comment above should be revisited — but the chunked
    // implementation stays correct either way.
    const big = bytes(256 * 1024);
    assert.throws(() => btoa(String.fromCharCode.apply(null, big)), RangeError);
  });
});
