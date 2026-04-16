/**
 * Tests for the JWT session detector. We polyfill localStorage + window for
 * the Node test environment.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEYS } from '../../src/utils/storageKeys.js';

class MemoryStorage {
  constructor() {
    this._m = new Map();
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
  clear() {
    this._m.clear();
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new MemoryStorage();
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = { location: { search: '' } };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { cookie: '' };
}

const { isValidSessionFormat, detectSession, SessionSource } = await import(
  '../../src/utils/sessionUtils.js'
);

describe('isValidSessionFormat (JWT)', () => {
  test('accepts a real-shape JWT', () => {
    assert.equal(isValidSessionFormat('eyJhbGciOi.payload.signature'), true);
    assert.equal(
      isValidSessionFormat('aA1_-.bB2_-.cC3_-'),
      true,
      'base64url chars + dots are valid'
    );
  });

  test('rejects PHPSESSID-style alphanumeric', () => {
    assert.equal(isValidSessionFormat('abcdefghij1234567890'), false);
  });

  test('rejects too-few segments', () => {
    assert.equal(isValidSessionFormat('header.payload'), false);
    assert.equal(isValidSessionFormat('justone'), false);
    assert.equal(isValidSessionFormat('a.b.c.d'), false);
  });

  test('rejects empty / non-string', () => {
    assert.equal(isValidSessionFormat(''), false);
    assert.equal(isValidSessionFormat(null), false);
    assert.equal(isValidSessionFormat(undefined), false);
    assert.equal(isValidSessionFormat(123), false);
  });
});

describe('detectSession', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.window.location.search = '';
  });

  test('returns NONE when nothing set', () => {
    const r = detectSession();
    assert.equal(r.sessionId, null);
    assert.equal(r.source, SessionSource.NONE);
  });

  test('picks up valid JWT from URL ?jwt=', () => {
    globalThis.window.location.search = '?jwt=eyJ.payload.sig';
    const r = detectSession();
    assert.equal(r.sessionId, 'eyJ.payload.sig');
    assert.equal(r.source, SessionSource.URL_JWT_PARAMETER);
  });

  test('rejects invalid-format URL ?jwt= (falls through to storage)', () => {
    globalThis.window.location.search = '?jwt=not-a-real-jwt';
    globalThis.localStorage.setItem(STORAGE_KEYS.JWT, 'eyJ.payload.sig');
    const r = detectSession();
    assert.equal(r.sessionId, 'eyJ.payload.sig');
    assert.equal(r.source, SessionSource.STORED_JWT);
  });

  test('falls back to localStorage when no URL', () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.JWT, 'eyJ.payload.sig');
    const r = detectSession();
    assert.equal(r.sessionId, 'eyJ.payload.sig');
    assert.equal(r.source, SessionSource.STORED_JWT);
  });

  test('URL JWT wins over storage', () => {
    globalThis.window.location.search = '?jwt=newJwt.fresh.sig';
    globalThis.localStorage.setItem(STORAGE_KEYS.JWT, 'oldJwt.stale.sig');
    const r = detectSession();
    assert.equal(r.sessionId, 'newJwt.fresh.sig');
    assert.equal(r.source, SessionSource.URL_JWT_PARAMETER);
  });

  test('cookies are no longer consulted (legacy PHPSESSID is ignored)', () => {
    globalThis.document.cookie = 'PHPSESSID=somelegacysessionid; remember_sid=other';
    const r = detectSession();
    assert.equal(r.sessionId, null);
    assert.equal(r.source, SessionSource.NONE);
  });
});
