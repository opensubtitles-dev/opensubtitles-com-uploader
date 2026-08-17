---
title: "08 — Testing Strategy"
aliases: [testing, test-plan, golden-replay]
tags: [uploader/testing, phase-2]
created: 2026-04-15
status: locked
---

# 08 — Testing Strategy

> [!INFO] Purpose
> Nothing ships without this passing. Coverage targets: every REST client method has a unit test; every user-facing flow is exercised by the manual production smoke test in §6.

## 1. Test stack

Current:
- `node --test tests/**/*.test.js` — Node built-in test runner
- `eslint` + `prettier` + `tsc --noEmit`

Adding:
- `msw` (Mock Service Worker) — intercepts `fetch` for unit tests with realistic HTTP
- `@testing-library/react` + `happy-dom` — component tests
- Golden-replay harness — deferred, see §7; it cannot target staging

## 2. Unit tests — REST client

File: `tests/services/api/restClient.test.js`

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { RestClient, AuthError, RestError } from '../../../src/services/api/restClient.js';

const server = setupServer();
// test harness setup...

describe('RestClient', () => {
  test('GET returns parsed JSON on 200', async () => {
    server.use(http.get('https://api.opensubtitles.com/api/v1/ping',
      () => HttpResponse.json({ ok: true })));
    const c = new RestClient({ baseUrl: 'https://api.opensubtitles.com/api/v1' });
    const r = await c.get('/ping');
    assert.deepEqual(r, { ok: true });
  });

  test('401 throws AuthError and calls onAuthExpired', async () => {
    let expiredCalled = false;
    authStore.registerOnExpired(() => { expiredCalled = true; });
    server.use(http.get('*/ping', () => new HttpResponse(null, { status: 401 })));
    const c = new RestClient();
    await assert.rejects(() => c.get('/ping'), AuthError);
    assert.equal(expiredCalled, true);
  });

  test('429 throws quota_exceeded RestError', async () => {
    server.use(http.post('*/subtitles/upload/check',
      () => HttpResponse.json({ error_code: 'quota_exceeded', message: 'Limit' }, { status: 429 })));
    const c = new RestClient();
    await assert.rejects(() => c.post('/subtitles/upload/check', {}),
      err => err.code === 'quota_exceeded' && err.status === 429);
  });

  test('authenticated:false omits Authorization header', async () => {
    let observed = {};
    server.use(http.get('*/anon', ({ request }) => {
      observed.auth = request.headers.get('Authorization');
      return HttpResponse.json({});
    }));
    authStore.setToken('fake.jwt.here');
    const c = new RestClient();
    await c.get('/anon', { authenticated: false });
    assert.equal(observed.auth, null);
  });

  test('network error is synthesized as RestError(network_error)', async () => {
    server.use(http.get('*/ping', () => HttpResponse.error()));
    const c = new RestClient();
    await assert.rejects(() => c.get('/ping'), err => err.code === 'network_error');
  });

  test('retry happens on 5xx but not on 4xx', async () => {
    let tries = 0;
    server.use(http.get('*/retry5xx', () => { tries++; return new HttpResponse(null, { status: 500 }); }));
    const c = new RestClient();
    await assert.rejects(() => c.get('/retry5xx'), err => err.code === 'server_error');
    assert.equal(tries, 2);   // first try + 1 retry
  });
});
```

### 2.1 Coverage targets

| File | Tests to write |
|---|---|
| `restClient.js` | 200/401/403/404/409/422/429/500 dispatch, retry logic, header composition, URL building with query params, FormData passthrough |
| `auth.js` | login 200/401/429, logout (endpoint exists vs 404), getUserInfo with/without Bearer |
| `upload.js` | check/commit/guess/createStubFeature — payload shape, anon mode |
| `myUploads.js` | list with pagination/filters, update, remove |
| `features.js` | searchByQuery, byImdbId (cache hit + miss) |
| `languages.js` | list (cache hit + miss, TTL expiry) |

## 3. Unit tests — auth state machine

File: `tests/services/authService.test.js`

```js
describe('authService', () => {
  test('login stores JWT + user + login_time in localStorage', async () => {
    // mock POST /login returns { token, user, status: 200 }
    // call authService.login('u', 'p')
    // assert localStorage has osdb_com_jwt, osdb_com_user, osdb_com_login_time
  });

  test('login with wrong creds throws without touching localStorage', async () => {
    // mock POST /login returns 401
    // localStorage should be empty after rejected login
  });

  test('hydrateFromStorage returns true when JWT + user present', async () => {
    // seed localStorage, call hydrate, assert state
  });

  test('logout clears all osdb_com_* keys + user cache', async () => {
    // seed, call logout, assert
  });

  test('migrateLegacyKeys runs once, then marker prevents re-run', async () => {
    // seed opensubtitles_token + opensubtitles_user_data
    // call migrateLegacyKeys twice
    // assert first run deleted, second run no-op
  });
});
```

## 4. Component tests

File: `tests/components/LoginDialog.test.jsx`

```js
test('submit calls authService.login with plaintext password', async () => {
  const { getByLabelText, getByRole } = render(
    <AuthContext.Provider value={mockAuthCtx}>
      <LoginDialog open={true} onClose={() => {}} />
    </AuthContext.Provider>
  );
  fireEvent.change(getByLabelText(/username/i), { target: { value: 'alice' } });
  fireEvent.change(getByLabelText(/password/i), { target: { value: 'secret' } });
  fireEvent.click(getByRole('button', { name: /log in/i }));
  await waitFor(() => expect(mockAuthCtx.login).toHaveBeenCalledWith('alice', 'secret', 'en'));
});

test('shows error banner on failed login', async () => {
  // mock login rejects with RestError('unauthorized')
  // assert ErrorBanner visible with correct copy
});
```

## 5. Hook tests

File: `tests/hooks/useUpload.test.js`

Cover the phase transitions: `idle → analyzing → needs_feature → checking → ready → committing → done` including error branches.

```js
test('analyze transitions to needs_feature', async () => {
  const { result } = renderHook(() => useUpload({ subtitleFile: fakeSrt }));
  act(() => result.current.analyze());
  await waitFor(() => expect(result.current.phase).toBe('needs_feature'));
  expect(result.current.payload.subhash).toMatch(/^[0-9a-f]{32}$/);
});

test('check with quota_exceeded goes to error with quota details', async () => {
  // mock uploadApi.check rejects with quota_exceeded
  // assert phase='error', error.code='quota_exceeded', error.details.quota present
});
```

## 6. Smoke test against production

Staging is not a viable target. It runs against the **production database**, it
does **not run sidekiq**, and it has **no dedicated opensearch indexes**. An
upload performed there is never properly saved or indexed — the test would look
green while exercising less than it claims, and it writes into the prod DB
regardless. That is the risk of production without the fidelity.

The smoke test therefore runs against production, using the environment switch
(design: `docs/superpowers/specs/2026-08-14-env-switch-design.md`).

**Prerequisite:** the API is already deployed in production; the **Kong routes**
must exist before this can run.

**Traceability.** Test uploads are identifiable two independent ways: by
subtitle source and upload date, and by the `User-Agent` string — `OpenSubtitles
Uploader PRO v2.0.0` (`src/utils/constants.js`), which no other build emits.

### Procedure

1. Build with the switch enabled: `VITE_ENV_SWITCH=true npm run tauri:build`
2. Launch, set the header switch to **Production**, and log in.
3. Upload one subtitle for a film already in the database. Confirm the response
   carries a subtitle id and the entry appears under Upload history.
4. Upload one subtitle for a title **not** in the database, using the
   create-from-id flow ([[11-stub-feature-from-imdb-tmdb]]).
5. Upload one episode subtitle, confirming it attaches to the episode and not to
   the parent series.
6. Delete each test upload through the app.
7. Confirm server-side that the rows are gone and no orphaned features remain.

Anything that fails here blocks the release.

## 7. Golden replay

> [!WARNING] Deferred — cannot target staging
> This section still describes replaying against staging, which is not viable
> for the reasons in §6 (prod database, no sidekiq, no dedicated opensearch
> indexes). The harness was never built. If it is revived, it must target
> production behind the environment switch and reuse §6's traceability and
> cleanup steps, or run against a backend that is genuinely isolated.

A small harness that takes real prod upload requests (anonymized) and replays them through the new client against staging, asserting server response shapes match expectations.

File: `tests/golden/replay.test.js`

```
tests/golden/
├── replay.test.js
└── fixtures/
    ├── upload-01-normal-movie.json
    ├── upload-02-tv-episode.json
    ├── upload-03-anonymous.json
    ├── upload-04-multi-cd.json
    └── upload-05-stub-feature.json
```

Each fixture:
```json
{
  "name": "Normal Movie Upload — Dune 2021 English",
  "payload": {
    "subhash": "...", "subfilename": "Dune.2021.srt", "subcontent": "<base64>",
    "idmovieimdb": "411008", "sublanguageid": "eng",
    "release_name": "Dune 2021 BluRay", "hearing_impaired": false, "hd": true
  },
  "expect": {
    "status": "created",
    "flags_applied_contains": ["high_definition"]
  }
}
```

Runner:
```js
test(`Golden replay: ${fixture.name}`, async () => {
  const res = await uploadApi.commit(fixture.payload);
  assert.equal(res.status, fixture.expect.status);
  for (const flag of fixture.expect.flags_applied_contains ?? []) {
    assert(res.flags_applied.includes(flag), `missing flag ${flag}`);
  }
  // cleanup
  if (res.subtitle_id) await myUploadsApi.remove(res.subtitle_id);
});
```

Fixtures seeded from **5 representative uploads** that cover:
1. Normal movie + English + trusted uploader
2. TV episode (season/episode params)
3. Anonymous upload (no JWT)
4. Multi-CD split (parent_subtitle_id flow)
5. Stub feature (create then upload against it)

Julien can extract these from prod logs; we anonymize + commit as fixtures.

## 8. Manual QA checklist (per-PR before merging to main fork branch)

- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npm test` — all green (unit + hook + component)
- [ ] Manual production smoke test (§6) — all seven steps pass
- [ ] `npm run tauri:dev` — manual upload end-to-end:
  - [ ] Login with a test account on production
  - [ ] Upload `.srt` + `.mkv` — commit returns subtitle_id + download URL
  - [ ] History tab shows new upload
  - [ ] Edit release_name, save, reload → persists
  - [ ] Delete → disappears
  - [ ] Logout → LoginDialog returns
- [ ] Anonymous upload (toggle in Settings) — works without logging in
- [ ] Movie not in DB → "Create new entry" flow → stub feature → upload → moderator queue note

## 9. CI wiring

`.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

CI runs unit tests only. The production smoke test (§6) is manual and
deliberately not automated: it writes real rows into the production database,
so it needs a human deciding when to run it and confirming the cleanup.

## 10. Performance bar

Not a primary goal for Phase 2 but a floor:

- First render to login form ≤ 1s on M1 Mac (currently ~600ms, don't regress)
- `/subtitles/upload/guess` round-trip ≤ 2s under normal conditions (backend owns this)
- Full upload flow from drop to "done" ≤ 10s for a 30 KB subtitle with video metadata extraction

## 11. Accessibility tests

- `axe-core` via `@axe-core/react` — lint against top-3 WCAG violations on each rendered screen
- Manual: tab through LoginDialog + UploadForm + HistoryList — no keyboard traps

## 12. Regression tests kept from original Uploader PRO

Current repo has tests in `tests/`. Audit + keep the ones that cover surviving logic:
- `subtitleHash` tests — keep (MD5 hashing survives)
- `movieHash` tests — keep (still client-side)
- `guessItService` tests — keep (REST endpoint unchanged)
- Any XML-RPC response parsing tests — **delete along with the code**

## 13. Checklist

- [ ] `msw` + `@testing-library/react` + `happy-dom` dependencies added
- [ ] `tests/services/api/` — restClient, auth, upload, myUploads, features, languages
- [ ] `tests/services/authService.test.js` — state machine
- [ ] `tests/components/` — LoginDialog, UploadForm, UploadHistory
- [ ] `tests/hooks/useUpload.test.js`
- [ ] `tests/golden/` — 5 fixtures + replay runner (deferred, §7)
- [ ] CI workflow: unit tests on every push
- [ ] Manual QA checklist in PR template
