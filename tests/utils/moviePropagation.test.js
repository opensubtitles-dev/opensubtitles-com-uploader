/**
 * Tests for giving a user-picked (or just created) movie to the other files
 * with the same title and year.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  parseMovieFilename,
  propagateMovieToSiblings,
} from '../../src/utils/episodePropagation.js';

const GODFATHER = {
  imdbid: 'tt0068646',
  title: 'The Godfather',
  year: 1972,
  kind: 'movie',
  reason: 'User confirmed entry from IMDb/TMDb id',
  feature_id: 42,
  provisional: true,
};

const files = [
  {
    path: '/a/The.Godfather.1972.720p.BrRip.x264.YIFY.mp4',
    name: 'The.Godfather.1972.720p.BrRip.x264.YIFY.mp4',
  },
  {
    path: '/b/The.Godfather.1972.1080p.BrRip.x264.BOKUTOX.YIFY.mp4',
    name: 'The.Godfather.1972.1080p.BrRip.x264.BOKUTOX.YIFY.mp4',
  },
  {
    path: '/b/The.Godfather.1972.1080p.BrRip.x264.BOKUTOX.YIFY.en.srt',
    name: 'The.Godfather.1972.1080p.BrRip.x264.BOKUTOX.YIFY.en.srt',
  },
  { path: '/c/The Godfather Part II (1974).mkv', name: 'The Godfather Part II (1974).mkv' },
  { path: '/d/The.Godfather.1991.mkv', name: 'The.Godfather.1991.mkv' },
];

describe('parseMovieFilename', () => {
  test('reads title and year from release names and folder-style names', () => {
    assert.deepStrictEqual(
      parseMovieFilename('The.Godfather.1972.1080p.BrRip.x264.BOKUTOX.YIFY.en.srt'),
      {
        titleKey: 'the godfather',
        year: 1972,
      }
    );
    assert.deepStrictEqual(parseMovieFilename('/x/The Godfather (1972) [1080p].mp4'), {
      titleKey: 'the godfather',
      year: 1972,
    });
  });

  test('gives null without a year, and for episodes', () => {
    assert.strictEqual(parseMovieFilename('The.Godfather.720p.mkv'), null);
    assert.strictEqual(parseMovieFilename('Norsemen.S03E02.2020.mkv'), null);
  });
});

describe('propagateMovieToSiblings', () => {
  const run = (movieGuesses = {}, newGuess = GODFATHER) =>
    propagateMovieToSiblings({ changedPath: files[0].path, newGuess, files, movieGuesses });

  test('gives the movie to files with the same title and year only', () => {
    const updates = run({ [files[1].path]: 'no-match', [files[2].path]: null });
    assert.deepStrictEqual(Object.keys(updates).sort(), [files[1].path, files[2].path].sort());
    const u = updates[files[1].path];
    assert.strictEqual(u.imdbid, 'tt0068646');
    assert.strictEqual(u.feature_id, 42);
    assert.strictEqual(u.propagated_from, files[0].path);
    assert.match(u.reason, /^Same movie as /);
  });

  test('replaces a wrong automatic guess and a previous propagation', () => {
    const updates = run({
      [files[1].path]: {
        imdbid: 'tt0642397',
        kind: 'episode',
        reason: 'Auto-guess (40% confidence)',
      },
      [files[2].path]: {
        imdbid: 'tt9999999',
        kind: 'movie',
        reason: 'Same movie as x',
        propagated_from: '/x',
      },
    });
    assert.deepStrictEqual(Object.keys(updates).sort(), [files[1].path, files[2].path].sort());
  });

  test('never overrides a hand pick, a created entry, a hash match or a running guess', () => {
    const updates = run({
      [files[1].path]: { imdbid: 'tt1', kind: 'movie', reason: 'User selected' },
      [files[2].path]: { imdbid: 'tt2', kind: 'movie', reason: 'Video hash match' },
    });
    assert.deepStrictEqual(updates, {});
    assert.deepStrictEqual(
      run({
        [files[1].path]: 'guessing',
        [files[2].path]: { imdbid: 'tt3', kind: 'movie', reason: 'User created provisional entry' },
      }),
      {}
    );
  });

  test('skips files already on that movie', () => {
    const updates = run({
      [files[1].path]: { ...GODFATHER, reason: 'Auto-guess' },
      [files[2].path]: 'no-match',
    });
    assert.deepStrictEqual(Object.keys(updates), [files[2].path]);
  });

  test('does nothing for episodes or a guess without an id', () => {
    assert.deepStrictEqual(run({}, { ...GODFATHER, kind: 'episode' }), {});
    assert.deepStrictEqual(run({}, { ...GODFATHER, imdbid: null, feature_id: null }), {});
  });
});
