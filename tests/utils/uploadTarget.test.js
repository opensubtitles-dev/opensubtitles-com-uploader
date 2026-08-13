import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildUploadTarget, describeUploadTarget } from '../../src/utils/uploadTarget.js';

describe('buildUploadTarget — identifier precedence', () => {
  test('feature_id wins over imdb and tmdb ids', () => {
    const target = buildUploadTarget({ feature_id: 9988012, imdbid: 'tt11114492', tmdbid: 84958 });

    assert.equal(target.primaryKey, 'feature_id');
    assert.deepEqual(target.payload, { feature_id: 9988012 });
  });

  test('imdb id wins over tmdb id when no feature_id', () => {
    const target = buildUploadTarget({ imdbid: 'tt11114492', tmdbid: 84958 });

    assert.equal(target.primaryKey, 'idmovieimdb');
    assert.deepEqual(target.payload, { idmovieimdb: 'tt11114492' });
  });

  test('tmdb id is the last resort', () => {
    const target = buildUploadTarget({ tmdbid: 84958 });

    assert.equal(target.primaryKey, 'tmdbid');
    assert.deepEqual(target.payload, { tmdbid: 84958 });
  });

  test('snake_case and camelCase spellings are both accepted', () => {
    assert.equal(buildUploadTarget({ featureId: 42 }).payload.feature_id, 42);
    assert.equal(buildUploadTarget({ imdb_id: 'tt0959621' }).payload.idmovieimdb, 'tt0959621');
    assert.equal(buildUploadTarget({ tmdb_id: 84958 }).payload.tmdbid, 84958);
  });

  test('no identifier at all yields an empty payload and hasTarget false', () => {
    const target = buildUploadTarget({ title: 'Norsemen', year: 2016 });

    assert.equal(target.hasTarget, false);
    assert.equal(target.primaryKey, null);
    assert.deepEqual(target.payload, {});
  });

  test('missing arguments do not throw', () => {
    assert.equal(buildUploadTarget().hasTarget, false);
    assert.equal(buildUploadTarget(null, null).hasTarget, false);
  });
});

describe('buildUploadTarget — bestMovieData vs movieData', () => {
  test('bestMovieData takes precedence over movieData', () => {
    const movieData = { imdbid: 'tt1234567' };
    const bestMovieData = { imdbid: 'tt7654321' };

    assert.equal(buildUploadTarget(movieData, bestMovieData).idmovieimdb, 'tt7654321');
  });

  test('episode-level imdb id is used instead of the parent series id', () => {
    const series = { imdbid: 'tt0411008', kind: 'tvshow' };
    const episode = { imdbid: 'tt0959621', kind: 'episode', season: 1, episode: 1 };

    const target = buildUploadTarget(series, episode);

    assert.equal(target.idmovieimdb, 'tt0959621');
    assert.deepEqual(target.payload, {
      idmovieimdb: 'tt0959621',
      season_number: 1,
      episode_number: 1,
    });
  });

  test('movieData is used as fallback when bestMovieData lacks an identifier', () => {
    const target = buildUploadTarget({ feature_id: 555 }, { title: 'no ids here' });

    assert.equal(target.primaryKey, 'feature_id');
    assert.equal(target.feature_id, 555);
  });

  test('movieData is used when bestMovieData is null', () => {
    assert.equal(buildUploadTarget({ imdbid: 'tt11114492' }, null).idmovieimdb, 'tt11114492');
  });
});

describe('buildUploadTarget — season/episode coordinates', () => {
  test('coords are attached when both season and episode are present', () => {
    const target = buildUploadTarget({ feature_id: 7, season_number: 4, episode_number: 4 });

    assert.equal(target.payload.season_number, 4);
    assert.equal(target.payload.episode_number, 4);
  });

  test('season 0 (specials) is a valid coordinate', () => {
    const target = buildUploadTarget({ feature_id: 7, season: 0, episode: 12 });

    assert.equal(target.payload.season_number, 0);
    assert.equal(target.payload.episode_number, 12);
  });

  test('a lone season without an episode is not attached', () => {
    const target = buildUploadTarget({ feature_id: 7, season_number: 4 });

    assert.deepEqual(target.payload, { feature_id: 7 });
  });

  test('a lone episode without a season is not attached', () => {
    const target = buildUploadTarget({ feature_id: 7, episode_number: 4 });

    assert.deepEqual(target.payload, { feature_id: 7 });
  });

  test('coords are dropped when there is no identifier to attach them to', () => {
    const target = buildUploadTarget({ season_number: 4, episode_number: 4 });

    assert.equal(target.hasTarget, false);
    assert.deepEqual(target.payload, {});
  });

  test('non-integer coords are rejected', () => {
    const target = buildUploadTarget({ feature_id: 7, season_number: 1.5, episode_number: 'abc' });

    assert.equal(target.season_number, null);
    assert.equal(target.episode_number, null);
    assert.deepEqual(target.payload, { feature_id: 7 });
  });
});

describe('buildUploadTarget — value normalization', () => {
  test('zero, negative and non-numeric feature ids are rejected', () => {
    assert.equal(buildUploadTarget({ feature_id: 0 }).feature_id, null);
    assert.equal(buildUploadTarget({ feature_id: -1 }).feature_id, null);
    assert.equal(buildUploadTarget({ feature_id: 'not-a-number' }).feature_id, null);
  });

  test('numeric strings are coerced to numbers', () => {
    const target = buildUploadTarget({ feature_id: '9988012' });

    assert.equal(target.feature_id, 9988012);
    assert.equal(typeof target.payload.feature_id, 'number');
  });

  test('imdb ids keep their tt prefix and are trimmed', () => {
    assert.equal(buildUploadTarget({ imdbid: '  tt11114492  ' }).idmovieimdb, 'tt11114492');
  });

  test('empty-string identifiers are ignored, not treated as present', () => {
    const target = buildUploadTarget({ feature_id: '', imdbid: '', tmdbid: 84958 });

    assert.equal(target.primaryKey, 'tmdbid');
  });

  test('a rejected feature_id falls through to the imdb id', () => {
    const target = buildUploadTarget({ feature_id: 0, imdbid: 'tt11114492' });

    assert.equal(target.primaryKey, 'idmovieimdb');
    assert.deepEqual(target.payload, { idmovieimdb: 'tt11114492' });
  });
});

describe('describeUploadTarget', () => {
  test('describes the chosen identifier', () => {
    assert.equal(describeUploadTarget(buildUploadTarget({ feature_id: 42 })), 'feature_id=42');
    assert.equal(
      describeUploadTarget(buildUploadTarget({ imdbid: 'tt11114492' })),
      'idmovieimdb=tt11114492'
    );
  });

  test('reports "none" when there is no target', () => {
    assert.equal(describeUploadTarget(buildUploadTarget({})), 'none');
  });

  test('reports "none" for null/undefined input instead of throwing', () => {
    assert.equal(describeUploadTarget(null), 'none');
    assert.equal(describeUploadTarget(undefined), 'none');
  });
});
