import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENTS,
  BACKEND_PREF_KEY,
  resolveEnvironmentId,
  buildSelectableList,
} from '../../src/config/environments.js';

class MemoryStorage {
  constructor(seed = {}) {
    this._m = new Map(Object.entries(seed));
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
}

describe('resolveEnvironmentId', () => {
  test('empty storage with switch enabled defaults to dev', () => {
    assert.equal(resolveEnvironmentId(new MemoryStorage(), true), 'dev');
  });

  test('empty storage with switch disabled defaults to prod', () => {
    assert.equal(resolveEnvironmentId(new MemoryStorage(), false), 'prod');
  });

  test('stored dev is honoured when the switch is enabled', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'dev' });
    assert.equal(resolveEnvironmentId(s, true), 'dev');
  });

  test('GATING INVARIANT: stored dev is ignored when the switch is disabled', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'dev' });
    assert.equal(resolveEnvironmentId(s, false), 'prod');
  });

  test('unknown stored id falls back to the default', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'staging' });
    assert.equal(resolveEnvironmentId(s, true), 'dev');
    assert.equal(resolveEnvironmentId(s, false), 'prod');
  });

  test('legacy dual-endpoint values (com/org) are not valid ids', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'com' });
    assert.equal(resolveEnvironmentId(s, true), 'dev');
  });

  test('missing storage does not throw', () => {
    assert.equal(resolveEnvironmentId(null, false), 'prod');
    assert.equal(resolveEnvironmentId(undefined, true), 'dev');
  });
});

describe('buildSelectableList', () => {
  test('is empty when the switch is disabled', () => {
    assert.deepEqual(buildSelectableList(false, ENVIRONMENTS), []);
  });

  test('omits dev when its base URL is not configured', () => {
    const envs = { ...ENVIRONMENTS, dev: { ...ENVIRONMENTS.dev, baseUrl: '' } };
    const ids = buildSelectableList(true, envs).map(e => e.id);
    assert.deepEqual(ids, ['prod']);
  });

  test('lists prod first, then dev, when both are configured', () => {
    const envs = {
      ...ENVIRONMENTS,
      dev: { ...ENVIRONMENTS.dev, baseUrl: 'https://osdev.ngrok.dev/api/v1' },
    };
    const ids = buildSelectableList(true, envs).map(e => e.id);
    assert.deepEqual(ids, ['prod', 'dev']);
  });
});

describe('ENVIRONMENTS shape', () => {
  test('prod always has the canonical base URL', () => {
    assert.equal(ENVIRONMENTS.prod.baseUrl, 'https://api.opensubtitles.com/api/v1');
  });

  test('every environment declares id and label', () => {
    for (const [id, env] of Object.entries(ENVIRONMENTS)) {
      assert.equal(env.id, id);
      assert.ok(env.label.length > 0);
    }
  });
});
