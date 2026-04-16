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
  adaptLegacyCheckPayload,
  adaptLegacyCommitPayload,
  restCheckResponseToLegacy,
  restCommitResponseToLegacy,
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
});

// ---------------------------------------------------------------------------
// Legacy payload adapters
// ---------------------------------------------------------------------------

describe('adaptLegacyCheckPayload', () => {
  test('flattens {subtitles:[{...}]} into REST shape', () => {
    const legacy = {
      subtitles: [
        {
          subhash: 'abc',
          subfilename: 'a.srt',
          moviehash: 'mh',
          moviebytesize: '12345',
          moviefilename: 'a.mkv',
          idmovieimdb: '133093',
          movietimems: '120000',
          moviefps: '23.976',
          movieframes: '2880',
        },
      ],
    };
    const r = adaptLegacyCheckPayload(legacy);
    assert.equal(r.subhash, 'abc');
    assert.equal(r.moviebytesize, 12345); // coerced to number
    assert.equal(r.movietimems, 120000);
    assert.equal(r.moviefps, 23.976);
    assert.equal(r.movieframes, 2880);
  });

  test('handles missing subtitles array', () => {
    assert.deepEqual(adaptLegacyCheckPayload(null).subhash, undefined);
    assert.deepEqual(adaptLegacyCheckPayload({}).subhash, undefined);
  });
});

describe('adaptLegacyCommitPayload', () => {
  test('flattens {baseinfo, cd1} into REST shape', () => {
    const legacy = {
      baseinfo: {
        idmovieimdb: '133093',
        moviereleasename: 'Matrix.1999.BluRay',
        movieaka: '',
        sublanguageid: 'eng',
        subauthorcomment: 'Synced',
        hearingimpaired: '0',
        highdefinition: '1',
        automatictranslation: '0',
        subtranslator: '',
        foreignpartsonly: '0',
      },
      cd1: {
        subhash: 'abc',
        subfilename: 'a.srt',
        moviehash: 'mh',
        moviebytesize: '12345',
        moviefilename: 'a.mkv',
        subcontent: 'BASE64_BLOB',
        movietimems: '120000',
        moviefps: '23.976',
        movieframes: '2880',
      },
      subcontent: 'TOPLEVEL_BLOB_FALLBACK',
    };
    const r = adaptLegacyCommitPayload(legacy);
    assert.equal(r.subhash, 'abc');
    assert.equal(r.subcontent, 'BASE64_BLOB'); // cd1 takes precedence
    assert.equal(r.idmovieimdb, '133093');
    assert.equal(r.sublanguageid, 'eng');
    assert.equal(r.release_name, 'Matrix.1999.BluRay');
    assert.equal(r.author_comments, 'Synced');
    assert.equal(r.high_definition, true);
    assert.equal(r.hearing_impaired, false);
    assert.equal(r.foreign_parts_only, false);
    assert.equal(r.automatic_translation, false);
  });

  test('falls back to top-level subcontent when cd1.subcontent absent', () => {
    const r = adaptLegacyCommitPayload({
      baseinfo: { sublanguageid: 'eng' },
      cd1: { subhash: 'abc' },
      subcontent: 'TOPLEVEL_BLOB',
    });
    assert.equal(r.subcontent, 'TOPLEVEL_BLOB');
  });

  test('coerces hearing_impaired/high_definition/foreign_parts_only from "1"|"0"|true|false|1|0', () => {
    const cases = [
      ['1', true],
      [1, true],
      [true, true],
      ['0', false],
      [0, false],
      [false, false],
      [undefined, false],
    ];
    for (const [input, expected] of cases) {
      const r = adaptLegacyCommitPayload({
        baseinfo: { hearingimpaired: input },
        cd1: {},
      });
      assert.equal(r.hearing_impaired, expected, `hearing_impaired for ${JSON.stringify(input)}`);
    }
  });
});

describe('restCheckResponseToLegacy', () => {
  test('maps already_in_db: true → alreadyindb: 1 with download URL', () => {
    const r = restCheckResponseToLegacy({
      already_in_db: true,
      duplicate_of: 12345,
      feature: { url: 'https://www.opensubtitles.com/subs/12345' },
    });
    assert.equal(r.status, '200 OK');
    assert.equal(r.alreadyindb, 1);
    assert.equal(r.data, 'https://www.opensubtitles.com/subs/12345');
    assert.equal(r.duplicate_of, 12345);
    assert.equal(r._rest.already_in_db, true);
  });

  test('maps already_in_db: false → alreadyindb: 0', () => {
    const r = restCheckResponseToLegacy({
      already_in_db: false,
      flags_suggested: { hd: true },
      quota: { remaining: 49 },
    });
    assert.equal(r.alreadyindb, 0);
    assert.equal(r.data, null);
    assert.deepEqual(r.flags_suggested, { hd: true });
    assert.equal(r.quota.remaining, 49);
  });

  test('handles null/garbage input safely', () => {
    assert.equal(restCheckResponseToLegacy(null).status, 'unknown');
    assert.equal(restCheckResponseToLegacy('not an object').status, 'unknown');
  });
});

describe('restCommitResponseToLegacy', () => {
  test('maps successful commit', () => {
    const r = restCommitResponseToLegacy({
      subtitle_id: 999,
      subfile_id: 5678,
      feature_id: 42,
      download_url: 'https://www.opensubtitles.com/subs/999',
      status: 'created',
      flags_applied: ['high_definition'],
      warnings: [],
      quota: { remaining: 48 },
    });
    assert.equal(r.status, '200 OK');
    assert.equal(r.alreadyindb, 0);
    assert.equal(r.data, 'https://www.opensubtitles.com/subs/999');
    assert.equal(r.subtitle_id, 999);
    assert.equal(r.review_status, 'created');
    assert.deepEqual(r.flags_applied, ['high_definition']);
  });

  test('flagged_for_review status surfaces in review_status', () => {
    const r = restCommitResponseToLegacy({
      subtitle_id: 1000,
      download_url: 'u',
      status: 'flagged_for_review',
      warnings: ['flagged_for_review'],
    });
    assert.equal(r.review_status, 'flagged_for_review');
    assert.deepEqual(r.warnings, ['flagged_for_review']);
  });
});
