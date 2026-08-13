/**
 * Tests for the upload REST service. Uses createUploadApi({ client }) so we
 * never load the singleton restClient (which transitively pulls in cache.js
 * and pako).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createUploadApi, normalizeGuessResult } from '../../../src/services/api/upload.js';

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

// ---------------------------------------------------------------------------
// uploadApi.commit + createStubFeature
// ---------------------------------------------------------------------------

describe('uploadApi.commit', () => {
  test('POSTs /subtitles/upload with full payload', async () => {
    const client = makeFakeClient(async () => ({ subtitle_id: 999, download_url: 'u' }));
    const api = createUploadApi({ client });

    const payload = {
      subhash: 'h',
      subfilename: 'a.srt',
      subcontent: 'BASE64_BLOB',
      sublanguageid: 'eng',
      idmovieimdb: '133093',
    };
    await api.commit(payload);
    assert.equal(client.calls[0].path, '/subtitles/upload');
    assert.deepEqual(client.calls[0].body, payload);
    assert.equal(client.calls[0].opts.authenticated, 'auto');
  });

  test('opts.anonymous=true forces authenticated:false', async () => {
    const client = makeFakeClient(async () => ({ subtitle_id: 1 }));
    const api = createUploadApi({ client });
    await api.commit({ subhash: 'h' }, { anonymous: true });
    assert.equal(client.calls[0].opts.authenticated, false);
  });
});

describe('uploadApi.createStubFeature', () => {
  test('POSTs /subtitles/upload/features/stub with body', async () => {
    const client = makeFakeClient(async () => ({ feature_id: 9001, provisional: true }));
    const api = createUploadApi({ client });
    await api.createStubFeature({ title: 'My Movie', year: 2024, type: 'movie' });
    assert.equal(client.calls[0].path, '/subtitles/upload/features/stub');
    assert.deepEqual(client.calls[0].body, { title: 'My Movie', year: 2024, type: 'movie' });
  });

  test('includes external ids and episode parent linkage when provided', async () => {
    const client = makeFakeClient(async () => ({ feature_id: 9002, provisional: true }));
    const api = createUploadApi({ client });
    await api.createStubFeature({
      title: 'Pilot',
      year: 2024,
      type: 'episode',
      imdb_id: 'tt1234567',
      tmdb_id: 123,
      source: 'imdb',
      season: 1,
      episode: 2,
      parent_imdbid: 'tt7654321',
      parent_feature_id: 42,
    });

    assert.deepEqual(client.calls[0].body, {
      title: 'Pilot',
      year: 2024,
      type: 'episode',
      imdb_id: 'tt1234567',
      tmdb_id: 123,
      source: 'imdb',
      season: 1,
      episode: 2,
      parent_imdbid: 'tt7654321',
      parent_feature_id: 42,
    });
  });
});

describe('uploadApi.resolveFromId', () => {
  const MOVIE_RESPONSE = {
    found: true,
    source: 'imdb',
    imdb_id: 'tt0133093',
    tmdb_id: 603,
    title: 'The Matrix',
    year: 1999,
    type: 'movie',
    exists_in_db: false,
    feature_id: null,
  };

  test('POSTs /subtitles/upload/features/from_id with imdb_id only', async () => {
    const client = makeFakeClient(async () => MOVIE_RESPONSE);
    const api = createUploadApi({ client });
    await api.resolveFromId({ imdbId: 'tt0133093' });

    assert.equal(client.calls[0].path, '/subtitles/upload/features/from_id');
    assert.deepEqual(client.calls[0].body, { imdb_id: 'tt0133093' });
    assert.equal(client.calls[0].opts.authenticated, 'auto');
  });

  test('POSTs with tmdb_id only', async () => {
    const client = makeFakeClient(async () => MOVIE_RESPONSE);
    const api = createUploadApi({ client });
    await api.resolveFromId({ tmdbId: 84958 });
    assert.deepEqual(client.calls[0].body, { tmdb_id: 84958 });
  });

  test('POSTs with both ids when both supplied', async () => {
    const client = makeFakeClient(async () => MOVIE_RESPONSE);
    const api = createUploadApi({ client });
    await api.resolveFromId({ imdbId: 'tt0133093', tmdbId: 603 });
    assert.deepEqual(client.calls[0].body, { imdb_id: 'tt0133093', tmdb_id: 603 });
  });

  test('omits ids that are null/undefined/empty', async () => {
    const client = makeFakeClient(async () => MOVIE_RESPONSE);
    const api = createUploadApi({ client });
    await api.resolveFromId({ imdbId: 'tt0133093', tmdbId: null });
    assert.equal('tmdb_id' in client.calls[0].body, false);

    await api.resolveFromId({ imdbId: '', tmdbId: 0 });
    // imdbId '' and tmdbId 0 both treated as absent (server returns missing_id;
    // client just sends empty body — server validates).
    assert.deepEqual(client.calls[1].body, {});
  });

  test('opts.anonymous=true forces authenticated:false', async () => {
    const client = makeFakeClient(async () => MOVIE_RESPONSE);
    const api = createUploadApi({ client });
    await api.resolveFromId({ imdbId: 'tt0133093' }, { anonymous: true });
    assert.equal(client.calls[0].opts.authenticated, false);
  });

  test('returns the server envelope verbatim for movie', async () => {
    const client = makeFakeClient(async () => MOVIE_RESPONSE);
    const api = createUploadApi({ client });
    const r = await api.resolveFromId({ imdbId: 'tt0133093' });
    assert.deepEqual(r, MOVIE_RESPONSE);
  });

  test('returns the server envelope verbatim for tvshow with series graph', async () => {
    const tvResponse = {
      found: true,
      source: 'imdb',
      imdb_id: 'tt9140554',
      title: 'Loki',
      year: 2021,
      type: 'tvshow',
      exists_in_db: false,
      feature_id: null,
      series: {
        seasons: [
          {
            season_number: 1,
            episode_count: 6,
            episodes: [
              {
                imdb_id: 'tt9419056',
                episode_number: 1,
                title: 'Glorious Purpose',
                year: 2021,
                runtime_seconds: 3360,
              },
            ],
          },
        ],
      },
    };
    const client = makeFakeClient(async () => tvResponse);
    const api = createUploadApi({ client });
    const r = await api.resolveFromId({ imdbId: 'tt9140554' });
    assert.deepEqual(r, tvResponse);
    assert.equal(r.series.seasons[0].episodes[0].imdb_id, 'tt9419056');
  });

  test('returns episode normalisation envelope (show + preselected)', async () => {
    const episodeResponse = {
      found: true,
      source: 'imdb',
      imdb_id: 'tt9140554',
      title: 'Loki',
      year: 2021,
      type: 'tvshow',
      preselected: {
        season_number: 1,
        episode_number: 1,
        imdb_id: 'tt9419056',
        title: 'Glorious Purpose',
      },
      series: { seasons: [{ season_number: 1, episode_count: 1, episodes: [] }] },
    };
    const client = makeFakeClient(async () => episodeResponse);
    const api = createUploadApi({ client });
    const r = await api.resolveFromId({ imdbId: 'tt9419056' });
    assert.equal(r.type, 'tvshow');
    assert.equal(r.imdb_id, 'tt9140554');
    assert.equal(r.preselected.season_number, 1);
    assert.equal(r.preselected.episode_number, 1);
  });

  test('passes signal through', async () => {
    const client = makeFakeClient(async () => MOVIE_RESPONSE);
    const api = createUploadApi({ client });
    const ctrl = new AbortController();
    await api.resolveFromId({ imdbId: 'tt0133093' }, { signal: ctrl.signal });
    assert.equal(client.calls[0].opts.signal, ctrl.signal);
  });
});

// ---------------------------------------------------------------------------
// (Phase E step 5, 2026-05-06) — Legacy payload + response adapter tests
// dropped along with the adapters themselves. The orchestration layer now
// emits and consumes REST shape directly; see
// docs/plans/10-orchestration-rewrite.md for the full sequence.
// ---------------------------------------------------------------------------
