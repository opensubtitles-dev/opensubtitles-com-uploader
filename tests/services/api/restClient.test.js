import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import authStore from '../../../src/services/api/authStore.js';
import {
  RestClient,
  RestError,
  AuthError,
  __test__,
} from '../../../src/services/api/restClient.js';

// ---------------------------------------------------------------------------
// Test fetch helper — replaces `delayedFetch` so we can assert the URL,
// inspect headers/body, and synthesize any Response we like without network IO.
// ---------------------------------------------------------------------------

function makeMockFetch(handler) {
  // handler: (url: string, init: RequestInit) => Promise<Response> | Response
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    return await handler(url, init);
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(body, { status = 200, statusText = 'OK' } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse({ status = 204 } = {}) {
  return new Response(null, { status });
}

function buildClient(handler, opts = {}) {
  return new RestClient({
    baseUrl: 'https://api.example.com/api/v1',
    apiKey: 'TEST-KEY',
    fetchFn: makeMockFetch(handler),
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RestClient — URL building', () => {
  test('relative path appended to baseUrl', async () => {
    const client = buildClient(() => jsonResponse({ ok: true }));
    await client.get('/ping');
    assert.equal(client._fetch.calls[0].url, 'https://api.example.com/api/v1/ping');
  });

  test('path without leading slash is normalized', async () => {
    const client = buildClient(() => jsonResponse({ ok: true }));
    await client.get('ping');
    assert.equal(client._fetch.calls[0].url, 'https://api.example.com/api/v1/ping');
  });

  test('trailing slash on baseUrl is stripped', async () => {
    const client = new RestClient({
      baseUrl: 'https://api.example.com/api/v1/',
      apiKey: 'K',
      fetchFn: makeMockFetch(() => jsonResponse({})),
    });
    await client.get('/ping');
    assert.equal(client._fetch.calls[0].url, 'https://api.example.com/api/v1/ping');
  });

  test('query params are appended; null/undefined skipped', async () => {
    const client = buildClient(() => jsonResponse({ ok: true }));
    await client.get('/search', { query: { q: 'matrix', page: 2, foo: null, bar: undefined } });
    const url = new URL(client._fetch.calls[0].url);
    assert.equal(url.searchParams.get('q'), 'matrix');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.has('foo'), false);
    assert.equal(url.searchParams.has('bar'), false);
  });

  test('absolute URL passed through unchanged', async () => {
    const client = buildClient(() => jsonResponse({ ok: true }));
    await client.get('https://other.example.com/foo');
    assert.equal(client._fetch.calls[0].url, 'https://other.example.com/foo');
  });
});

describe('RestClient — headers', () => {
  beforeEach(() => authStore._reset());

  test('Api-Key always sent', async () => {
    const client = buildClient(() => jsonResponse({}));
    await client.get('/ping');
    assert.equal(client._fetch.calls[0].init.headers['Api-Key'], 'TEST-KEY');
  });

  test('Authorization Bearer added when token present and authenticated="auto"', async () => {
    authStore.setToken('eyJjwt');
    const client = buildClient(() => jsonResponse({}));
    await client.get('/protected');
    assert.equal(client._fetch.calls[0].init.headers.Authorization, 'Bearer eyJjwt');
  });

  test('Authorization omitted when authenticated:false even if token present', async () => {
    authStore.setToken('eyJjwt');
    const client = buildClient(() => jsonResponse({}));
    await client.get('/anon', { authenticated: false });
    assert.equal(client._fetch.calls[0].init.headers.Authorization, undefined);
  });

  test('Authorization omitted when no token (anonymous)', async () => {
    const client = buildClient(() => jsonResponse({}));
    await client.get('/anon');
    assert.equal(client._fetch.calls[0].init.headers.Authorization, undefined);
  });

  test('Content-Type stripped for FormData bodies', async () => {
    if (typeof FormData === 'undefined') return; // skip in environments without FormData
    const client = buildClient(() => jsonResponse({}));
    const fd = new FormData();
    fd.append('file', new Blob(['hi']), 'a.txt');
    await client.post('/upload', fd);
    assert.equal(client._fetch.calls[0].init.headers['Content-Type'], undefined);
  });
});

describe('RestClient — body serialization', () => {
  test('JSON body stringified', async () => {
    const client = buildClient(() => jsonResponse({}));
    await client.post('/x', { foo: 'bar', n: 1 });
    assert.equal(client._fetch.calls[0].init.body, '{"foo":"bar","n":1}');
  });

  test('FormData passed through as-is', async () => {
    if (typeof FormData === 'undefined') return;
    const client = buildClient(() => jsonResponse({}));
    const fd = new FormData();
    fd.append('k', 'v');
    await client.post('/x', fd);
    assert.ok(client._fetch.calls[0].init.body instanceof FormData);
  });

  test('GET with no body has no body field', async () => {
    const client = buildClient(() => jsonResponse({}));
    await client.get('/x');
    assert.equal(client._fetch.calls[0].init.body, undefined);
  });
});

describe('RestClient — response parsing', () => {
  test('200 with JSON body returns parsed', async () => {
    const client = buildClient(() => jsonResponse({ token: 'abc', user: { id: 1 } }));
    const r = await client.get('/login');
    assert.deepEqual(r, { token: 'abc', user: { id: 1 } });
  });

  test('204 No Content returns null', async () => {
    const client = buildClient(() => emptyResponse({ status: 204 }));
    const r = await client.delete('/x');
    assert.equal(r, null);
  });

  test('200 with malformed JSON returns null without throwing', async () => {
    const client = buildClient(() =>
      new Response('not-json{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const r = await client.get('/x');
    assert.equal(r, null);
  });
});

describe('RestClient — error handling', () => {
  beforeEach(() => authStore._reset());

  test('401 throws AuthError + invokes onAuthExpired', async () => {
    let expired = 0;
    authStore.registerOnExpired(() => {
      expired += 1;
    });
    const client = buildClient(() =>
      jsonResponse({ message: 'expired' }, { status: 401 })
    );
    await assert.rejects(client.get('/me'), AuthError);
    assert.equal(expired, 1);
  });

  test('401 on anonymous call does NOT trigger onAuthExpired', async () => {
    let expired = 0;
    authStore.registerOnExpired(() => {
      expired += 1;
    });
    const client = buildClient(() =>
      jsonResponse({ message: 'wat' }, { status: 401 })
    );
    await assert.rejects(client.get('/x', { authenticated: false }), AuthError);
    assert.equal(expired, 0);
  });

  test('429 throws RestError(quota_exceeded)', async () => {
    const client = buildClient(() =>
      jsonResponse({ error_code: 'quota_exceeded', message: 'limit', details: { retry_after: 60 } }, { status: 429 })
    );
    await assert.rejects(client.post('/upload', {}), (err) => {
      assert.ok(err instanceof RestError);
      assert.equal(err.code, 'quota_exceeded');
      assert.equal(err.status, 429);
      assert.equal(err.details.retry_after, 60);
      return true;
    });
  });

  test('400 with error_code propagates code', async () => {
    const client = buildClient(() =>
      jsonResponse({ error_code: 'invalid_language', message: 'bad lang' }, { status: 400 })
    );
    await assert.rejects(client.post('/x', {}), (err) => {
      assert.equal(err.code, 'invalid_language');
      assert.equal(err.status, 400);
      return true;
    });
  });

  test('5xx without body falls back to server_error', async () => {
    const client = buildClient(
      () =>
        new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    );
    await assert.rejects(client.get('/x', { retries: 0 }), (err) => {
      assert.equal(err.code, 'server_error');
      assert.equal(err.status, 500);
      return true;
    });
  });

  test('4xx without error_code falls back to http_<status>', async () => {
    const client = buildClient(() => new Response(null, { status: 418, statusText: "I'm a teapot" }));
    await assert.rejects(client.get('/x'), (err) => {
      assert.equal(err.code, 'http_418');
      assert.equal(err.status, 418);
      return true;
    });
  });
});

describe('RestClient — retry behavior', () => {
  test('retries on 5xx (default 1 retry → 2 attempts)', async () => {
    let calls = 0;
    const client = buildClient(() => {
      calls += 1;
      return new Response(null, { status: 503 });
    });
    await assert.rejects(client.get('/x'), RestError);
    assert.equal(calls, 2);
  });

  test('retries=0 means single attempt', async () => {
    let calls = 0;
    const client = buildClient(() => {
      calls += 1;
      return new Response(null, { status: 503 });
    });
    await assert.rejects(client.get('/x', { retries: 0 }), RestError);
    assert.equal(calls, 1);
  });

  test('does NOT retry 4xx', async () => {
    let calls = 0;
    const client = buildClient(() => {
      calls += 1;
      return jsonResponse({ error_code: 'validation_error', message: 'x' }, { status: 422 });
    });
    await assert.rejects(client.post('/x', {}), RestError);
    assert.equal(calls, 1);
  });

  test('does NOT retry 401', async () => {
    let calls = 0;
    const client = buildClient(() => {
      calls += 1;
      return jsonResponse({ message: 'expired' }, { status: 401 });
    });
    await assert.rejects(client.get('/me'), AuthError);
    assert.equal(calls, 1);
  });

  test('first attempt 5xx then 200 succeeds', async () => {
    let calls = 0;
    const client = buildClient(() => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 502 }) : jsonResponse({ ok: true });
    });
    const r = await client.get('/x');
    assert.deepEqual(r, { ok: true });
    assert.equal(calls, 2);
  });

  test('network error retries then succeeds', async () => {
    let calls = 0;
    const client = buildClient(() => {
      calls += 1;
      if (calls === 1) {
        const err = new TypeError('Failed to fetch');
        return Promise.reject(err);
      }
      return jsonResponse({ ok: true });
    });
    const r = await client.get('/x');
    assert.deepEqual(r, { ok: true });
    assert.equal(calls, 2);
  });
});

describe('RestClient — network error synthesis', () => {
  test('TypeError with "fetch" → RestError(network_error)', () => {
    const synth = __test__.synthesizeNetworkError;
    const err = synth(new TypeError('Failed to fetch'));
    assert.ok(err instanceof RestError);
    assert.equal(err.code, 'network_error');
    assert.equal(err.status, 0);
  });

  test('AbortError → RestError(timeout)', () => {
    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    const synth = __test__.synthesizeNetworkError;
    const err = synth(aborted);
    assert.equal(err.code, 'timeout');
  });

  test('unknown error → RestError(unknown)', () => {
    const synth = __test__.synthesizeNetworkError;
    const err = synth(new Error('weird'));
    assert.equal(err.code, 'unknown');
    assert.equal(err.message, 'weird');
  });
});

describe('RestClient — verb shortcuts', () => {
  test('GET / POST / PATCH / PUT / DELETE all dispatch correct method', async () => {
    const client = buildClient(() => jsonResponse({}));
    await client.get('/g');
    await client.post('/p', { x: 1 });
    await client.patch('/pa', { x: 2 });
    await client.put('/pu', { x: 3 });
    await client.delete('/d');

    const methods = client._fetch.calls.map((c) => c.init.method);
    assert.deepEqual(methods, ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
  });
});
