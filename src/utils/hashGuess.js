// Identification by video hash.
//
// The first guess for a video uses its filename only, so it is not held up
// while the file is hashed. Once the hash is known, /guess is asked again
// with it. When subtitles already on the site are linked to that exact video
// and agree on its feature, the server answers with source "moviehash", and
// that answer replaces the filename guess. It names the exact feature
// (episode included), whatever the file is called.
//
// It never replaces a feature the user chose, or one given to the file from
// the user's choice on another file of the same show.

export const HASH_REASON = 'Video hash match';

export const isManualGuess = guess =>
  guess != null &&
  typeof guess === 'object' &&
  (guess.reason === 'User selected' || guess.propagated_from != null);

/**
 * Guess to apply from a /guess response made with a moviehash, or null when
 * the hash did not decide.
 *
 * @param {{ best_guess: object|null, source?: string|null }|null} result
 *   uploadApi.guess() return value
 * @returns {object|null}
 */
export function hashGuessFromResult(result) {
  if (!result || result.source !== 'moviehash') return null;
  const best = result.best_guess;
  if (!best || !best.feature_id || !best.title) return null;

  const guess = { ...best, reason: HASH_REASON, matched_by: 'moviehash' };

  if (guess.kind === 'episode') {
    // Same field names the rest of the uploader reads for episodes.
    guess.season = guess.season_number;
    guess.episode = guess.episode_number;
    if (guess.parent_imdb_id) {
      guess.parent_imdbid = guess.parent_imdb_id;
      guess.series_imdb_id = guess.parent_imdb_id;
    }
    if (guess.show_title && guess.season_number != null && guess.episode_number != null) {
      const s = String(guess.season_number).padStart(2, '0');
      const e = String(guess.episode_number).padStart(2, '0');
      guess.formatted_title = `${guess.show_title} - S${s}E${e}`;
    }
  }

  return guess;
}

/**
 * Whether the hash guess should replace what the file holds now.
 *
 * @param {object|string|undefined} current  movieGuesses[path]: a guess, or
 *   'guessing' / 'no-match' / 'error' / undefined
 * @param {object|null} hashGuess  from hashGuessFromResult
 */
export function shouldApplyHashGuess(current, hashGuess) {
  if (!hashGuess) return false;
  if (isManualGuess(current)) return false;
  return true;
}
