/**
 * Tests for SubtitleUploadService — REST-shape regression coverage for the
 * Phase E orchestration rewrite (commits 69a33ec / 1690e8c / c17e7f7 /
 * 2b12f1d / caed7f7 / aecf1c8). Pins the contract that the four `prepare*`
 * static methods emit flat REST payloads matching docs/api/upload-v2-contract.md
 * §2.1 and §2.2 — NOT the legacy XML-RPC envelopes (`{subtitles:[...]}` /
 * `{baseinfo, cd1, subcontent}`).
 *
 * Keeps the test surface small and focused on the shape contract because:
 *   - The HTTP layer (uploadApi.check/commit) is already covered by
 *     tests/services/api/upload.test.js.
 *   - The processUpload classification logic in step 4 is now thin enough
 *     that a green smoke (manual against staging — see commit 2b12f1d) is
 *     sufficient; full E2E mocking of pairedFiles/movieGuesses/etc. would
 *     produce a brittle test that's mostly testing the mock setup.
 *
 * What we DO test here:
 *   - prepare* methods return REST-flat shape (no envelopes)
 *   - field renames (moviereleasename → release_name etc.)
 *   - boolean conversion ('0'/'1'/true/false → boolean)
 *   - orphan variants omit moviehash/moviebytesize/moviefilename
 */

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SubtitleUploadService } from '../../src/services/subtitleUploadService.js';
import { SubtitleHashService } from '../../src/services/subtitleHash.js';

// Minimal noop debug callback
const noop = () => {};

// Stub video / subtitle / movie data shaped like the real callers
function makeVideo({
  movieHash = '0123456789abcdef',
  size = 1_500_000_000,
  name = 'Movie.2010.BluRay.mkv',
} = {}) {
  return { fullPath: `/v/${name}`, name, size, movieHash };
}
function makeSubtitle({ name = 'Movie.2010.BluRay.eng.srt' } = {}) {
  return { fullPath: `/s/${name}`, name, file: { name } };
}
function makeMovieData({ imdbid = '1375666', kind = 'movie' } = {}) {
  return { imdbid, kind };
}

// Patch SubtitleHashService methods that hit FileReader / debug — node:test
// runs in plain Node and FileReader isn't there.
let restoreHashStubs = [];
beforeEach(() => {
  restoreHashStubs = [
    mock.method(
      SubtitleHashService,
      'readAndHashSubtitleFile',
      async (_file, includeContent = false) =>
        includeContent
          ? {
              hash: 'aaaa1111bbbb2222cccc3333dddd4444',
              size: 12345,
              content: '1\n00:00:01,000 --> 00:00:02,000\nHello\n',
              contentGzipBase64: 'BASE64GZIPBLOB==',
            }
          : { hash: 'aaaa1111bbbb2222cccc3333dddd4444', size: 12345 }
    ),
    mock.method(SubtitleHashService, 'getLanguageId', () => 'eng'),
    mock.method(SubtitleHashService, 'debugCompressedContent', () => ({
      contentMatch: true,
      hashMatch: true,
      originalHash: 'aaaa1111bbbb2222cccc3333dddd4444',
      decompressedHash: 'aaaa1111bbbb2222cccc3333dddd4444',
    })),
  ];
});
afterEach(() => {
  restoreHashStubs.forEach(s => s.mock.restore());
  restoreHashStubs = [];
});

// ---------------------------------------------------------------------------
// prepareUploadDataForSingleSubtitle (paired /check payload)
// ---------------------------------------------------------------------------

describe('prepareUploadDataForSingleSubtitle', () => {
  test('returns REST-flat shape (no subtitles[] envelope)', async () => {
    const r = await SubtitleUploadService.prepareUploadDataForSingleSubtitle({
      video: makeVideo(),
      subtitle: makeSubtitle(),
      movieData: makeMovieData(),
      guessItData: {},
      featuresByImdbId: {},
      getSubtitleLanguage: () => 'en',
      uploadOptions: {},
      combinedLanguages: {},
      addDebugInfo: noop,
      getVideoMetadata: () => null,
    });

    assert.equal(r.subtitles, undefined, 'must NOT have legacy `subtitles[]` envelope');
    assert.equal(r.subhash, 'aaaa1111bbbb2222cccc3333dddd4444');
    assert.equal(r.subfilename, 'Movie.2010.BluRay.eng.srt');
    assert.equal(r.moviehash, '0123456789abcdef');
    assert.equal(r.moviebytesize, '1500000000');
    assert.equal(r.moviefilename, 'Movie.2010.BluRay.mkv');
    assert.equal(r.idmovieimdb, '1375666');
  });

  test('includes movietimems / moviefps / movieframes when getVideoMetadata returns them', async () => {
    const r = await SubtitleUploadService.prepareUploadDataForSingleSubtitle({
      video: makeVideo(),
      subtitle: makeSubtitle(),
      movieData: makeMovieData(),
      guessItData: {},
      featuresByImdbId: {},
      getSubtitleLanguage: () => 'en',
      uploadOptions: {},
      combinedLanguages: {},
      addDebugInfo: noop,
      getVideoMetadata: () => ({ movietimems: 7200000, moviefps: 23.976, movieframes: 172607 }),
    });

    assert.equal(r.movietimems, '7200000');
    assert.equal(r.moviefps, '23.976');
    assert.equal(r.movieframes, '172607');
  });

  test('omits movie metadata fields when getVideoMetadata returns null', async () => {
    const r = await SubtitleUploadService.prepareUploadDataForSingleSubtitle({
      video: makeVideo(),
      subtitle: makeSubtitle(),
      movieData: makeMovieData(),
      guessItData: {},
      featuresByImdbId: {},
      getSubtitleLanguage: () => 'en',
      uploadOptions: {},
      combinedLanguages: {},
      addDebugInfo: noop,
      getVideoMetadata: () => null,
    });

    assert.equal('movietimems' in r, false);
    assert.equal('moviefps' in r, false);
    assert.equal('movieframes' in r, false);
  });
});

// ---------------------------------------------------------------------------
// prepareActualUploadData (paired /upload payload)
// ---------------------------------------------------------------------------

describe('prepareActualUploadData', () => {
  test('returns REST-flat shape with renamed metadata fields', async () => {
    const r = await SubtitleUploadService.prepareActualUploadData({
      video: makeVideo(),
      subtitle: makeSubtitle(),
      movieData: makeMovieData(),
      guessItData: {},
      featuresByImdbId: {},
      getSubtitleLanguage: () => 'en',
      uploadOptions: {
        '/s/Movie.2010.BluRay.eng.srt': {
          moviereleasename: 'Movie.2010.BluRay.x264-RELEASE',
          movieaka: 'Movie AKA',
          subauthorcomment: 'Synced + cleaned',
          subtranslator: 'NameOfTranslator',
          hearingimpaired: '1',
          highdefinition: '1',
          foreignpartsonly: '0',
          automatictranslation: '0',
        },
      },
      combinedLanguages: {},
      addDebugInfo: noop,
      getVideoMetadata: () => null,
    });

    // No legacy envelope
    assert.equal(r.baseinfo, undefined, 'must NOT have legacy `baseinfo`');
    assert.equal(r.cd1, undefined, 'must NOT have legacy `cd1`');

    // Identification at top level
    assert.equal(r.subhash, 'aaaa1111bbbb2222cccc3333dddd4444');
    assert.equal(r.subfilename, 'Movie.2010.BluRay.eng.srt');
    assert.equal(r.subcontent, 'BASE64GZIPBLOB==');
    assert.equal(r.moviehash, '0123456789abcdef');
    assert.equal(r.idmovieimdb, '1375666');
    assert.equal(r.sublanguageid, 'eng');

    // Field renames
    assert.equal(r.release_name, 'Movie.2010.BluRay.x264-RELEASE');
    assert.equal(r.movie_aka, 'Movie AKA');
    assert.equal(r.author_comments, 'Synced + cleaned');
    assert.equal(r.translator, 'NameOfTranslator');

    // Boolean conversion (was '0'/'1')
    assert.equal(r.hearing_impaired, true);
    assert.equal(r.high_definition, true);
    assert.equal(r.foreign_parts_only, false);
    assert.equal(r.automatic_translation, false);
  });

  test('coerces flag values from "1"|"0"|true|false to boolean', async () => {
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
      const r = await SubtitleUploadService.prepareActualUploadData({
        video: makeVideo(),
        subtitle: makeSubtitle(),
        movieData: makeMovieData(),
        guessItData: {},
        featuresByImdbId: {},
        getSubtitleLanguage: () => 'en',
        uploadOptions: {
          '/s/Movie.2010.BluRay.eng.srt': { hearingimpaired: input },
        },
        combinedLanguages: {},
        addDebugInfo: noop,
        getVideoMetadata: () => null,
      });
      assert.equal(r.hearing_impaired, expected, `hearing_impaired for ${JSON.stringify(input)}`);
    }
  });

  test('subcontent only at top level (not duplicated under any envelope)', async () => {
    const r = await SubtitleUploadService.prepareActualUploadData({
      video: makeVideo(),
      subtitle: makeSubtitle(),
      movieData: makeMovieData(),
      guessItData: {},
      featuresByImdbId: {},
      getSubtitleLanguage: () => 'en',
      uploadOptions: {},
      combinedLanguages: {},
      addDebugInfo: noop,
      getVideoMetadata: () => null,
    });

    assert.equal(r.subcontent, 'BASE64GZIPBLOB==');
    assert.equal(r.cd1, undefined);
  });
});

// ---------------------------------------------------------------------------
// prepareUploadDataForOrphanedSubtitle (orphan /check payload)
// ---------------------------------------------------------------------------

describe('prepareUploadDataForOrphanedSubtitle', () => {
  test('returns REST-flat shape with no movie file fields', async () => {
    const r = await SubtitleUploadService.prepareUploadDataForOrphanedSubtitle({
      subtitle: makeSubtitle(),
      movieData: makeMovieData(),
      guessItData: {},
      featuresByImdbId: {},
      getSubtitleLanguage: () => 'en',
      uploadOptions: {},
      combinedLanguages: {},
      addDebugInfo: noop,
      orphanedSubtitlesFps: {},
    });

    assert.equal(r.subtitles, undefined, 'must NOT have legacy `subtitles[]` envelope');
    assert.equal(r.subhash, 'aaaa1111bbbb2222cccc3333dddd4444');
    assert.equal(r.subfilename, 'Movie.2010.BluRay.eng.srt');
    // Orphan: no movie file paired
    assert.equal('moviehash' in r, false);
    assert.equal('moviebytesize' in r, false);
    assert.equal('moviefilename' in r, false);
    assert.equal('idmovieimdb' in r, false); // not sent on /check for orphans
  });

  test('includes moviefps when user supplied it', async () => {
    const r = await SubtitleUploadService.prepareUploadDataForOrphanedSubtitle({
      subtitle: makeSubtitle(),
      movieData: makeMovieData(),
      guessItData: {},
      featuresByImdbId: {},
      getSubtitleLanguage: () => 'en',
      uploadOptions: {},
      combinedLanguages: {},
      addDebugInfo: noop,
      orphanedSubtitlesFps: { '/s/Movie.2010.BluRay.eng.srt': '23.976' },
    });
    assert.equal(r.moviefps, '23.976');
  });

  test('omits moviefps when not supplied', async () => {
    const r = await SubtitleUploadService.prepareUploadDataForOrphanedSubtitle({
      subtitle: makeSubtitle(),
      movieData: makeMovieData(),
      guessItData: {},
      featuresByImdbId: {},
      getSubtitleLanguage: () => 'en',
      uploadOptions: {},
      combinedLanguages: {},
      addDebugInfo: noop,
      orphanedSubtitlesFps: {},
    });
    assert.equal('moviefps' in r, false);
  });
});

// ---------------------------------------------------------------------------
// prepareActualUploadDataForOrphanedSubtitle (orphan /upload payload)
// ---------------------------------------------------------------------------

describe('prepareActualUploadDataForOrphanedSubtitle', () => {
  test('returns REST-flat shape with no movie file fields, but with idmovieimdb', async () => {
    const r = await SubtitleUploadService.prepareActualUploadDataForOrphanedSubtitle({
      subtitle: makeSubtitle(),
      movieData: makeMovieData(),
      guessItData: {},
      featuresByImdbId: {},
      getSubtitleLanguage: () => 'en',
      uploadOptions: {},
      combinedLanguages: {},
      addDebugInfo: noop,
      orphanedSubtitlesFps: {},
    });

    assert.equal(r.baseinfo, undefined, 'no legacy baseinfo');
    assert.equal(r.cd1, undefined, 'no legacy cd1');
    assert.equal(r.subhash, 'aaaa1111bbbb2222cccc3333dddd4444');
    assert.equal(r.subcontent, 'BASE64GZIPBLOB==');
    assert.equal(r.idmovieimdb, '1375666'); // commit DOES include it for orphans
    assert.equal(r.sublanguageid, 'eng');
    // No movie file
    assert.equal('moviehash' in r, false);
    assert.equal('moviebytesize' in r, false);
    assert.equal('moviefilename' in r, false);
  });

  test('feature flags converted to booleans', async () => {
    const r = await SubtitleUploadService.prepareActualUploadDataForOrphanedSubtitle({
      subtitle: makeSubtitle(),
      movieData: makeMovieData(),
      guessItData: {},
      featuresByImdbId: {},
      getSubtitleLanguage: () => 'en',
      uploadOptions: {
        '/s/Movie.2010.BluRay.eng.srt': {
          hearingimpaired: '1',
          highdefinition: '0',
          foreignpartsonly: '1',
          automatictranslation: '1',
        },
      },
      combinedLanguages: {},
      addDebugInfo: noop,
      orphanedSubtitlesFps: {},
    });

    assert.equal(r.hearing_impaired, true);
    assert.equal(r.high_definition, false);
    assert.equal(r.foreign_parts_only, true);
    assert.equal(r.automatic_translation, true);
  });
});
