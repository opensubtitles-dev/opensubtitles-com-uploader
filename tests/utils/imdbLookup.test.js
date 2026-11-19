/**
 * Tests for listing IMDb title-lookup rows next to our own search results.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  imdbLookupRowToSearchRow,
  isNewImdbRow,
  mergeSearchResults,
} from '../../src/utils/imdbLookup.js';

describe('imdbLookupRowToSearchRow', () => {
  test('maps a server row to the search-row shape', () => {
    const row = imdbLookupRowToSearchRow({
      imdb_id: 'tt0211915',
      title: 'Amélie',
      original_title: "Le fabuleux destin d'Amélie Poulain",
      year: 2001,
      type: 'movie',
      votes: 850579,
      feature_id: null,
    });
    assert.deepStrictEqual(
      {
        id: row.id,
        name: row.name,
        original_title: row.original_title,
        year: row.year,
        kind: row.kind,
        imdb_id: row.imdb_id,
        feature_id: row.feature_id,
        source: row.source,
      },
      {
        id: 'tt0211915',
        name: 'Amélie',
        original_title: "Le fabuleux destin d'Amélie Poulain",
        year: 2001,
        kind: 'movie',
        imdb_id: 211915,
        feature_id: null,
        source: 'imdb',
      }
    );
  });

  test('drops rows without a usable IMDb id', () => {
    assert.strictEqual(imdbLookupRowToSearchRow(null), null);
    assert.strictEqual(imdbLookupRowToSearchRow({ title: 'x' }), null);
    assert.strictEqual(imdbLookupRowToSearchRow({ imdb_id: 'tt0000000' }), null);
  });
});

describe('isNewImdbRow', () => {
  test('is true only for IMDb rows we do not have', () => {
    assert.strictEqual(isNewImdbRow({ source: 'imdb', feature_id: null }), true);
    assert.strictEqual(isNewImdbRow({ source: 'imdb', feature_id: 12 }), false);
    assert.strictEqual(isNewImdbRow({ feature_id: null }), false);
    assert.strictEqual(isNewImdbRow(null), false);
  });
});

describe('mergeSearchResults', () => {
  test('keeps our rows first and adds the IMDb rows they do not list', () => {
    const local = [
      { id: 'tt0642397', imdb_id: 642397, kind: 'episode' },
      { id: 'tt0071562', imdb_id: 71562, kind: 'movie' },
    ];
    const imdb = [
      { id: 'tt0068646', imdb_id: 68646, source: 'imdb' },
      { id: 'tt0071562', imdb_id: 71562, source: 'imdb' },
    ];
    assert.deepStrictEqual(
      mergeSearchResults(local, imdb).map(r => r.id),
      ['tt0642397', 'tt0071562', 'tt0068646']
    );
  });

  test('works when either side is empty', () => {
    assert.deepStrictEqual(mergeSearchResults([], [{ id: 'tt1', imdb_id: 1 }]).length, 1);
    assert.deepStrictEqual(mergeSearchResults([{ id: 'tt1', imdb_id: 1 }]).length, 1);
  });
});
