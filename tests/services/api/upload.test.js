/**
 * Tests for the upload REST service. Uses createUploadApi({ client }) so we
 * never load the singleton restClient (which transitively pulls in cache.js
 * and pako).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUploadApi,
  normalizeGuessResult,
} from '../../../src/services/api/upload.js';

function makeFakeClient(handler) {
  const calls = [];
  return {
    calls,
    async post(path, body, opts) {
      calls.push({ path, body, opts });
      return handler(path, body, opts);
    },
  };
}

const BEST = {
  feature_id: 646193,
  imdbid: 133093,
  tmdbid: 603,
  title: 'The Matrix',
  year: 1999,
  type: 'Movie',
  score: 0.97,
};

// ---------------------------------------------------------------------------
// normalizeGuessResult
// ---------------------------------------------------------------------------

describe('normalizeGuessResult', () => {
  test('returns null for null/undefined/non-object', () => {
    assert.equal(normalizeGuessResult(null), null);
    assert.equal(normalizeGuessResult(undefined), null);
    assert.equal(normalizeGuessResult('not'), null);
  });

  test('builds full legacy + new shape', () => {
    const r = normalizeGuessResult(BEST);
    assert.equal(r.imdbid, 'tt0133093');
    assert.equal(r.title, 'The Matrix');
    assert.equal(r.year, 1999);
    assert.equal(r.kind, 'movie');
    assert.equal(r.feature_id, 646193);
    assert.equal(r.tmdb_id, 603);
    assert.equal(r.score, 0.97);
    assert.match(r.reason, /Auto-guess.*97%/);
  });

  test('lowercases kind', () => {
    assert.equal(normalizeGuessResult({ ...BEST, type: 'Tvshow' }).kind, 'tvshow');
    assert.equal(normalizeGuessResult({ ...BEST, type: 'EPISODE' }).kind, 'episode');
  });

  test('handles missing imdbid → null', () => {
    const r = normalizeGuessResult({ title: 'X', year: 2024, type: 'Movie' });
    assert.equal(r.imdbid, null);
    assert.equal(r.title, 'X');
  });

  test('pads short imdbid to 7 digits', () => {
    assert.equal(normalizeGuessResult({ imdbid: 1234, title: 'X' }).imdbid, 'tt0001234');
  });

  test('reason without score falls back to plain text', () => {
    const r = normalizeGuessResult({ ...BEST, score: undefined });
    assert.equal(r.reason, 'Auto-guess');
  });

  test('reason override works', () => {
    const r = normalizeGuessResult(BEST, 'Directory match: foo');
    assert.equal(r.reason, 'Directory match: foo');
  });
});

// ---------------------------------------------------------------------------
// uploadApi.guess
// ---------------------------------------------------------------------------

describe('uploadApi.guess', () => {
  test('POSTs /subtitles/upload/guess with filename only', async () => {
    const client = makeFakeClient(async () => ({ best_guess: BEST, candidates: [] }));
    const api = createUploadApi({ client });

    await api.guess('Matrix.1999.srt');
    assert.equal(client.calls[0].path, '/subtitles/upload/guess');
    assert.deepEqual(client.calls[0].body, { filename: 'Matrix.1999.srt' });
  });

  test('includes moviehash when supplied', async () => {
    const client = makeFakeClient(async () => ({ best_guess: BEST, candidates: [] }));
    const api = createUploadApi({ client });
    await api.guess('Matrix.srt', 'abc123def456');
    assert.equal(client.calls[0].body.moviehash, 'abc123def456');
  });

  test('omits moviehash when null/undefined', async () => {
    const client = makeFakeClient(async () => ({ best_guess: BEST, candidates: [] }));
    const api = createUploadApi({ client });
    await api.guess('Matrix.srt', null);
    assert.equal('moviehash' in client.calls[0].body, false);
  });

  test('uses authenticated:auto by default (sends Bearer if available)', async () => {
    const client = makeFakeClient(async () => ({ best_guess: BEST }));
    const api = createUploadApi({ client });
    await api.guess('m.srt');
    assert.equal(client.calls[0].opts.authenticated, 'auto');
  });

  test('opts.anonymous=true forces authenticated:false', async () => {
    const client = makeFakeClient(async () => ({ best_guess: BEST }));
    const api = createUploadApi({ client });
    await api.guess('m.srt', null, { anonymous: true });
    assert.equal(client.calls[0].opts.authenticated, false);
  });

  test('returns normalized best_guess + candidates + raw', async () => {
    const raw = {
      best_guess: BEST,
      candidates: [BEST, { ...BEST, feature_id: 999 }],
    };
    const client = makeFakeClient(async () => raw);
    const api = createUploadApi({ client });
    const r = await api.guess('m.srt');
    assert.equal(r.best_guess.imdbid, 'tt0133093');
    assert.equal(r.candidates.length, 2);
    assert.equal(r.candidates[1].feature_id, 999);
    assert.equal(r.raw, raw);
  });

  test('best_guess null when server returns no match', async () => {
    const client = makeFakeClient(async () => ({ best_guess: null, candidates: [] }));
    const api = createUploadApi({ client });
    const r = await api.guess('zzznomatch.srt');
    assert.equal(r.best_guess, null);
    assert.deepEqual(r.candidates, []);
  });

  test('non-array candidates → []', async () => {
    const client = makeFakeClient(async () => ({ best_guess: BEST, candidates: null }));
    const api = createUploadApi({ client });
    const r = await api.guess('m.srt');
    assert.deepEqual(r.candidates, []);
  });

  test('coerces filename to string', async () => {
    const client = makeFakeClient(async () => ({ best_guess: null }));
    const api = createUploadApi({ client });
    await api.guess(null);
    assert.equal(client.calls[0].body.filename, '');
  });

  test('passes signal through', async () => {
    const client = makeFakeClient(async () => ({ best_guess: null }));
    const api = createUploadApi({ client });
    const ctrl = new AbortController();
    await api.guess('m.srt', null, { signal: ctrl.signal });
    assert.equal(client.calls[0].opts.signal, ctrl.signal);
  });
});

// ---------------------------------------------------------------------------
// uploadApi.check
// ---------------------------------------------------------------------------

describe('uploadApi.check', () => {
  test('POSTs /subtitles/upload/check with payload and authenticated:auto by default', async () => {
    const client = makeFakeClient(async () => ({ already_in_db: false }));
    const api = createUploadApi({ client });

    const payload = { subhash: 'abc123', subfilename: 'a.srt', sublanguageid: 'eng' };
    await api.check(payload);

    assert.equal(client.calls[0].path, '/subtitles/upload/check');
    assert.deepEqual(client.calls[0].body, payload);
    assert.equal(client.calls[0].opts.authenticated, 'auto');
  });

  test('strips subcontent before sending (commit-only field)', async () => {
    const client = makeFakeClient(async () => ({ already_in_db: false }));
    const api = createUploadApi({ client });

    await api.check({
      subhash: 'abc123',
      subfilename: 'a.srt',
      sublanguageid: 'eng',
      subcontent: 'BIG_BASE64_BLOB_WE_DONT_NEED_FOR_CHECK',
    });

    assert.equal('subcontent' in client.calls[0].body, false);
    assert.equal(client.calls[0].body.subhash, 'abc123');
  });

  test('opts.anonymous=true forces authenticated:false', async () => {
    const client = makeFakeClient(async () => ({}));
    const api = createUploadApi({ client });
    await api.check({ subhash: 'x' }, { anonymous: true });
    assert.equal(client.calls[0].opts.authenticated, false);
  });

  test('returns the server envelope verbatim', async () => {
    const envelope = {
      already_in_db: true,
      duplicate_of: 12345,
      feature: { feature_id: 42, title: 'X' },
      would_be_rejected: false,
      rejection_reasons: [],
      flags_suggested: { hd: true },
      quota: { remaining: 49 },
    };
    const client = makeFakeClient(async () => envelope);
    const api = createUploadApi({ client });
    const r = await api.check({ subhash: 'x', subfilename: 'a.srt', sublanguageid: 'eng' });
    assert.deepEqual(r, envelope);
  });

  test('handles null/empty payload without throwing', async () => {
    const client = makeFakeClient(async () => ({}));
    const api = createUploadApi({ client });
    await api.check(null);
    assert.deepEqual(client.calls[0].body, {});
  });

  test('passes signal through', async () => {
    const client = makeFakeClient(async () => ({}));
    const api = createUploadApi({ client });
    const ctrl = new AbortController();
    await api.check({ subhash: 'x' }, { signal: ctrl.signal });
    assert.equal(client.calls[0].opts.signal, ctrl.signal);
  });
});
