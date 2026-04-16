import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import authStore from '../../../src/services/api/authStore.js';

describe('authStore', () => {
  beforeEach(() => authStore._reset());

  test('getToken returns null when nothing set', () => {
    assert.equal(authStore.getToken(), null);
  });

  test('setToken / getToken round-trip', () => {
    authStore.setToken('eyJabc');
    assert.equal(authStore.getToken(), 'eyJabc');
  });

  test('setToken(null) clears', () => {
    authStore.setToken('x');
    authStore.setToken(null);
    assert.equal(authStore.getToken(), null);
  });

  test('setToken("") clears (falsy)', () => {
    authStore.setToken('x');
    authStore.setToken('');
    assert.equal(authStore.getToken(), null);
  });

  test('onAuthExpired calls registered handler', () => {
    let called = 0;
    authStore.registerOnExpired(() => {
      called += 1;
    });
    authStore.onAuthExpired();
    authStore.onAuthExpired();
    assert.equal(called, 2);
  });

  test('onAuthExpired with no handler is a no-op', () => {
    // default handler is a no-op — must not throw
    assert.doesNotThrow(() => authStore.onAuthExpired());
  });

  test('handler that throws does not crash onAuthExpired', () => {
    authStore.registerOnExpired(() => {
      throw new Error('boom');
    });
    assert.doesNotThrow(() => authStore.onAuthExpired());
  });

  test('registerOnExpired rejects non-functions', () => {
    assert.throws(() => authStore.registerOnExpired('not a function'), TypeError);
    assert.throws(() => authStore.registerOnExpired(null), TypeError);
  });
});
