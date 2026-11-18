/**
 * Tests for identifying a video by its hash once it is computed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  HASH_REASON,
  hashGuessFromResult,
  shouldApplyHashGuess,
} from '../../src/utils/hashGuess.js';
import { normalizeGuessResult } from '../../src/services/api/upload.js';
import { buildUploadTarget } from '../../src/utils/uploadTarget.js';

const episodeBest = normalizeGuessResult({
  feature_id: 180480,
  imdbid: 7777001,
  title: 'Episode #3.2',
  year: 2020,
  type: 'Episode',
  season_number: 3,
  episode_number: 2,
  parent_title: 'Norsemen',
  parent_imdb_id: 5905354,
  parent_year: 2016,
});

const movieBest = normalizeGuessResult({
  feature_id: 646193,
  imdbid: 133093,
  title: 'The Matrix',
  year: 1999,
  type: 'Movie',
});

describe('hashGuessFromResult', () => {
  test('ignores answers the hash did not decide', () => {
    assert.strictEqual(hashGuessFromResult(null), null);
    assert.strictEqual(hashGuessFromResult({ best_guess: movieBest, source: 'title' }), null);
    assert.strictEqual(hashGuessFromResult({ best_guess: movieBest, source: null }), null);
    assert.strictEqual(hashGuessFromResult({ best_guess: null, source: 'moviehash' }), null);
  });

  test('marks a movie as matched by the video hash', () => {
    const guess = hashGuessFromResult({ best_guess: movieBest, source: 'moviehash' });
    assert.strictEqual(guess.feature_id, 646193);
    assert.strictEqual(guess.reason, HASH_REASON);
    assert.strictEqual(guess.matched_by, 'moviehash');
  });

  test('gives an episode its show and coordinates, and uploads to the exact episode', () => {
    const guess = hashGuessFromResult({ best_guess: episodeBest, source: 'moviehash' });
    assert.strictEqual(guess.kind, 'episode');
    assert.strictEqual(guess.season, 3);
    assert.strictEqual(guess.episode, 2);
    assert.strictEqual(guess.parent_imdbid, 'tt5905354');
    assert.strictEqual(guess.series_imdb_id, 'tt5905354');
    assert.strictEqual(guess.formatted_title, 'Norsemen - S03E02');
    assert.deepStrictEqual(buildUploadTarget(guess).payload, {
      feature_id: 180480,
      season_number: 3,
      episode_number: 2,
    });
  });
});

describe('shouldApplyHashGuess', () => {
  const hashGuess = hashGuessFromResult({ best_guess: movieBest, source: 'moviehash' });

  test('replaces a pending, failed or filename guess', () => {
    assert.strictEqual(shouldApplyHashGuess(undefined, hashGuess), true);
    assert.strictEqual(shouldApplyHashGuess('guessing', hashGuess), true);
    assert.strictEqual(shouldApplyHashGuess('no-match', hashGuess), true);
    assert.strictEqual(shouldApplyHashGuess('error', hashGuess), true);
    assert.strictEqual(
      shouldApplyHashGuess({ title: 'Matrix Reloaded', reason: 'Auto-guess' }, hashGuess),
      true
    );
  });

  test("keeps the user's choice and what was given from it", () => {
    assert.strictEqual(
      shouldApplyHashGuess({ title: 'X', reason: 'User selected' }, hashGuess),
      false
    );
    assert.strictEqual(
      shouldApplyHashGuess(
        { title: 'X', reason: 'Same show as a.srt', propagated_from: 'a' },
        hashGuess
      ),
      false
    );
  });

  test('does nothing without a hash guess', () => {
    assert.strictEqual(shouldApplyHashGuess('guessing', null), false);
  });
});
