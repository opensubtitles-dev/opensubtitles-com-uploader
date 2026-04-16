import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMyUploadsApi } from '../../../src/services/api/myUploads.js';

function makeFakeClient(handlers = {}) {
  const calls = [];
  return {
    calls,
    async get(path, opts) {
      calls.push({ method: 'GET', path, opts });
      return handlers.get ? handlers.get(path, opts) : null;
    },
    async patch(path, body, opts) {
      calls.push({ method: 'PATCH', path, body, opts });
      return handlers.patch ? handlers.patch(path, body, opts) : null;
    },
    async delete(path, opts) {
      calls.push({ method: 'DELETE', path, opts });
      return handlers.delete ? handlers.delete(path, opts) : null;
    },
  };
}

const PAGE = {
  data: [
    { subtitle_id: 1, release_name: 'a', enabled: true },
    { subtitle_id: 2, release_name: 'b', enabled: true },
  ],
  meta: { total_count: 17, page: 1, per_page: 20, total_pages: 1 },
};

describe('myUploadsApi.list', () => {
  test('GETs /my/uploads with default pagination', async () => {
    const client = makeFakeClient({ get: async () => PAGE });
    const api = createMyUploadsApi({ client });
    const r = await api.list();
    assert.equal(client.calls[0].path, '/my/uploads');
    assert.deepEqual(client.calls[0].opts.query, { page: 1, per_page: 20 });
    assert.equal(r.data.length, 2);
    assert.equal(r.meta.total_count, 17);
  });

  test('passes page + perPage', async () => {
    const client = makeFakeClient({ get: async () => PAGE });
    const api = createMyUploadsApi({ client });
    await api.list({ page: 3, perPage: 50 });
    assert.equal(client.calls[0].opts.query.page, 3);
    assert.equal(client.calls[0].opts.query.per_page, 50);
  });

  test('adds language_code filter when present', async () => {
    const client = makeFakeClient({ get: async () => PAGE });
    const api = createMyUploadsApi({ client });
    await api.list({ languageCode: 'eng' });
    assert.equal(client.calls[0].opts.query.language_code, 'eng');
  });

  test('omits language_code when undefined/empty', async () => {
    const client = makeFakeClient({ get: async () => PAGE });
    const api = createMyUploadsApi({ client });
    await api.list({});
    assert.equal('language_code' in client.calls[0].opts.query, false);
  });

  test('encodes enabled filter (true/false)', async () => {
    const client = makeFakeClient({ get: async () => PAGE });
    const api = createMyUploadsApi({ client });
    await api.list({ enabled: false });
    assert.equal(client.calls[0].opts.query.enabled, false);
    await api.list({ enabled: true });
    assert.equal(client.calls[1].opts.query.enabled, true);
  });

  test('passes signal through', async () => {
    const client = makeFakeClient({ get: async () => PAGE });
    const api = createMyUploadsApi({ client });
    const ctrl = new AbortController();
    await api.list({ signal: ctrl.signal });
    assert.equal(client.calls[0].opts.signal, ctrl.signal);
  });
});

describe('myUploadsApi.update', () => {
  test('PATCHes /my/uploads/:id with body', async () => {
    const client = makeFakeClient({
      patch: async () => ({ subtitle_id: 1, status: 'updated', subtitle: {} }),
    });
    const api = createMyUploadsApi({ client });
    const patch = { release_name: 'NEW', hd: true };
    await api.update(1, patch);
    assert.equal(client.calls[0].method, 'PATCH');
    assert.equal(client.calls[0].path, '/my/uploads/1');
    assert.deepEqual(client.calls[0].body, patch);
  });

  test('coerces id into the URL', async () => {
    const client = makeFakeClient({ patch: async () => ({}) });
    const api = createMyUploadsApi({ client });
    await api.update(99999, {});
    assert.equal(client.calls[0].path, '/my/uploads/99999');
  });
});

describe('myUploadsApi.remove', () => {
  test('DELETEs /my/uploads/:id', async () => {
    const client = makeFakeClient({
      delete: async () => ({ subtitle_id: 1, status: 'deleted' }),
    });
    const api = createMyUploadsApi({ client });
    await api.remove(1);
    assert.equal(client.calls[0].method, 'DELETE');
    assert.equal(client.calls[0].path, '/my/uploads/1');
  });
});
