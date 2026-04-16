/**
 * Tests for the auth REST service. Uses createAuthApi({ client }) so we
 * never load the singleton restClient (which transitively pulls in cache.js
 * and pako, which isn't installed in this dev env).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthApi } from '../../../src/services/api/auth.js';

function makeFakeClient(handlers = {}) {
  const calls = [];
  return {
    calls,
    async post(path, body, opts) {
      calls.push({ method: 'POST', path, body, opts });
      return handlers.post ? handlers.post(path, body, opts) : null;
    },
    async get(path, opts) {
      calls.push({ method: 'GET', path, opts });
      return handlers.get ? handlers.get(path, opts) : null;
    },
    async delete(path, opts) {
      calls.push({ method: 'DELETE', path, opts });
      return handlers.delete ? handlers.delete(path, opts) : null;
    },
  };
}

const SUCCESS_LOGIN = {
  user: {
    user_id: 66,
    level: 'Sub leecher',
    vip: false,
    allowed_downloads: 20,
    allowed_translations: 5,
    ext_installed: false,
  },
  token: 'eyJhbGciOi.payload.signature',
  status: 200,
  base_url: 'https://www.opensubtitles.com',
};

describe('authApi.login', () => {
  test('POSTs /login with authenticated:false and returns server envelope', async () => {
    const client = makeFakeClient({
      post: async () => SUCCESS_LOGIN,
    });
    const api = createAuthApi({ client });

    const r = await api.login({ username: 'alice', password: 'plain' });
    assert.deepEqual(r, SUCCESS_LOGIN);
    assert.equal(client.calls[0].path, '/login');
    assert.deepEqual(client.calls[0].body, { username: 'alice', password: 'plain' });
    assert.equal(client.calls[0].opts.authenticated, false);
  });

  test('passes plaintext password (no MD5 hashing)', async () => {
    const client = makeFakeClient({ post: async () => SUCCESS_LOGIN });
    const api = createAuthApi({ client });
    await api.login({ username: 'alice', password: 'super-secret-pass' });
    assert.equal(client.calls[0].body.password, 'super-secret-pass');
  });

  test('propagates errors from the client', async () => {
    const client = makeFakeClient({
      post: async () => {
        const e = new Error('Invalid credentials');
        e.status = 401;
        throw e;
      },
    });
    const api = createAuthApi({ client });
    await assert.rejects(() => api.login({ username: 'a', password: 'b' }), /Invalid credentials/);
  });
});

describe('authApi.logout', () => {
  test('DELETEs /logout', async () => {
    const client = makeFakeClient({ delete: async () => ({ message: 'ok', status: 200 }) });
    const api = createAuthApi({ client });
    const r = await api.logout();
    assert.deepEqual(r, { message: 'ok', status: 200 });
    assert.equal(client.calls[0].method, 'DELETE');
    assert.equal(client.calls[0].path, '/logout');
  });

  test('swallows 401 (token already invalid)', async () => {
    const client = makeFakeClient({
      delete: async () => {
        const e = new Error('expired');
        e.status = 401;
        throw e;
      },
    });
    const api = createAuthApi({ client });
    const r = await api.logout();
    assert.equal(r.status, 401);
    assert.match(r.message, /expired|best-effort/i);
  });

  test('swallows 404 (endpoint not deployed)', async () => {
    const client = makeFakeClient({
      delete: async () => {
        const e = new Error('not found');
        e.status = 404;
        throw e;
      },
    });
    const api = createAuthApi({ client });
    const r = await api.logout();
    assert.equal(r.status, 404);
  });

  test('swallows arbitrary errors but returns status:0 sentinel', async () => {
    const client = makeFakeClient({
      delete: async () => {
        throw new Error('network down');
      },
    });
    const api = createAuthApi({ client });
    const r = await api.logout();
    assert.equal(r.status, 0);
    assert.match(r.message, /network down|best-effort/i);
  });
});

describe('authApi.getUserInfo', () => {
  test('GETs /infos/user and unwraps {data: ...}', async () => {
    const inner = { user_id: 66, level: 'Sub leecher', vip: false };
    const client = makeFakeClient({ get: async () => ({ data: inner }) });
    const api = createAuthApi({ client });
    const r = await api.getUserInfo();
    assert.deepEqual(r, inner);
    assert.equal(client.calls[0].path, '/infos/user');
  });

  test('passes through if response has no data wrapper', async () => {
    const inner = { user_id: 66, level: 'Sub leecher' };
    const client = makeFakeClient({ get: async () => inner });
    const api = createAuthApi({ client });
    const r = await api.getUserInfo();
    assert.deepEqual(r, inner);
  });

  test('returns null for null/empty response', async () => {
    const client = makeFakeClient({ get: async () => null });
    const api = createAuthApi({ client });
    const r = await api.getUserInfo();
    assert.equal(r, null);
  });
});
