import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENTS,
  BACKEND_PREF_KEY,
  resolveEnvironmentId,
  buildSelectableList,
  setActiveEnvironment,
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

// A registry where dev has a usable baseUrl — for tests that exercise
// storage/switch resolution independent of whether this particular build
// has a dev URL configured (the real ENVIRONMENTS.dev.baseUrl depends on
// VITE_OPENSUBTITLES_BASE_URL, which is unset in the unit-test process).
const DEV_CONFIGURED = {
  ...ENVIRONMENTS,
  dev: { ...ENVIRONMENTS.dev, baseUrl: 'https://osdev.ngrok.dev/api/v1' },
};

describe('resolveEnvironmentId', () => {
  test('empty storage with switch enabled defaults to dev', () => {
    assert.equal(resolveEnvironmentId(new MemoryStorage(), true, DEV_CONFIGURED), 'dev');
  });

  test('empty storage with switch disabled defaults to prod', () => {
    assert.equal(resolveEnvironmentId(new MemoryStorage(), false), 'prod');
  });

  test('stored dev is honoured when the switch is enabled', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'dev' });
    assert.equal(resolveEnvironmentId(s, true, DEV_CONFIGURED), 'dev');
  });

  test('GATING INVARIANT: stored dev is ignored when the switch is disabled', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'dev' });
    assert.equal(resolveEnvironmentId(s, false), 'prod');
  });

  test('unknown stored id falls back to the default', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'staging' });
    assert.equal(resolveEnvironmentId(s, true, DEV_CONFIGURED), 'dev');
    assert.equal(resolveEnvironmentId(s, false), 'prod');
  });

  test('legacy dual-endpoint values (com/org) are not valid ids', () => {
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'com' });
    assert.equal(resolveEnvironmentId(s, true, DEV_CONFIGURED), 'dev');
  });

  test('missing storage does not throw', () => {
    assert.equal(resolveEnvironmentId(null, false), 'prod');
    assert.equal(resolveEnvironmentId(undefined, true, DEV_CONFIGURED), 'dev');
  });

  test('USABILITY GUARD: switch enabled but dev base URL unconfigured falls back to prod', () => {
    const envs = { ...ENVIRONMENTS, dev: { ...ENVIRONMENTS.dev, baseUrl: '' } };
    assert.equal(resolveEnvironmentId(new MemoryStorage(), true, envs), 'prod');
  });

  test('USABILITY GUARD: stored dev preference falls back to prod when dev base URL is unconfigured', () => {
    const envs = { ...ENVIRONMENTS, dev: { ...ENVIRONMENTS.dev, baseUrl: '' } };
    const s = new MemoryStorage({ [BACKEND_PREF_KEY]: 'dev' });
    assert.equal(resolveEnvironmentId(s, true, envs), 'prod');
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

describe('setActiveEnvironment', () => {
  test('rejects invalid ids', () => {
    const storage = new MemoryStorage();
    let reloadCalled = false;
    const result = setActiveEnvironment('staging', {
      storage,
      switchEnabled: true,
      reload: () => {
        reloadCalled = true;
      },
    });
    assert.equal(result, false);
    assert.equal(reloadCalled, false);
    assert.equal(storage.getItem(BACKEND_PREF_KEY), null);
  });

  test('selects a different environment when switch enabled', () => {
    // Empty storage with switchEnabled:true resolves to 'prod' here: this
    // process has no VITE_OPENSUBTITLES_BASE_URL, so the real ENVIRONMENTS.dev
    // has no usable baseUrl and the resolver's usability guard falls back to
    // 'prod' (see resolveEnvironmentId). So we select 'dev' to change to a
    // different environment.
    const storage = new MemoryStorage();
    let reloadCallCount = 0;
    const result = setActiveEnvironment('dev', {
      storage,
      switchEnabled: true,
      reload: () => {
        reloadCallCount++;
      },
    });
    assert.equal(result, true);
    assert.equal(reloadCallCount, 1);
    assert.equal(storage.getItem(BACKEND_PREF_KEY), 'dev');
  });

  test('no-op when selecting already-active environment', () => {
    const storage = new MemoryStorage({ [BACKEND_PREF_KEY]: 'prod' });
    let reloadCalled = false;
    const result = setActiveEnvironment('prod', {
      storage,
      switchEnabled: true,
      reload: () => {
        reloadCalled = true;
      },
    });
    assert.equal(result, false);
    assert.equal(reloadCalled, false);
    // Storage should not have been written to
    assert.equal(storage.getItem(BACKEND_PREF_KEY), 'prod');
  });

  test('storage.setItem error is caught and returns false', () => {
    let setItemCalled = false;
    const throwingStorage = {
      getItem() {
        return null;
      },
      setItem() {
        setItemCalled = true;
        throw new Error('Storage quota exceeded');
      },
    };
    let reloadCalled = false;
    // Use 'dev' since empty storage defaults to 'prod' here (this process has
    // no configured dev baseUrl — see the previous test for why).
    const result = setActiveEnvironment('dev', {
      storage: throwingStorage,
      switchEnabled: true,
      reload: () => {
        reloadCalled = true;
      },
    });
    assert.equal(result, false);
    assert.equal(reloadCalled, false);
    assert.equal(setItemCalled, true, 'setItem should have been called');
  });

  test('enforces gating invariant: switch disabled always returns false', () => {
    const storage = new MemoryStorage();
    let reloadCalled = false;
    const result = setActiveEnvironment('dev', {
      storage,
      switchEnabled: false,
      reload: () => {
        reloadCalled = true;
      },
    });
    assert.equal(result, false);
    assert.equal(reloadCalled, false);
    assert.equal(storage.getItem(BACKEND_PREF_KEY), null);
  });
});
