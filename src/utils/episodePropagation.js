// When the user picks the show and episode for one file, give the same show
// to the other files of that series, each with the season/episode its own
// filename names.
//
// Before: dropping a season of "Norsemen.S03E0x..." files that the guess did
// not match meant clicking "Change", searching the show and picking the
// episode once per file. Now the first pick is enough: every other file whose
// name carries the same series title and an SxxEyy gets that show and its own
// coordinates. The server resolves (show, season, episode) itself and creates
// episodes it knows from IMDb and does not have yet, so no feature id is
// needed for those files.
//
// Never overrides a file the user set by hand (reason 'User selected').

const VIDEO_OR_SUB_EXT =
  /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpg|mpeg|srt|sub|ass|ssa|vtt|smi|txt)$/i;

// SxxEyy (also "S01 E03", "s1.e3") or 1x02.
const SXXEYY = /^(.*?)[\s._\-[(]*s(\d{1,2})[\s._-]*e(\d{1,3})(?!\d)/i;
const NXNN = /^(.*?)[\s._\-[(]+(\d{1,2})x(\d{2,3})(?!\d)/i;

// "Norsemen", "norsemen ", "Norsemen.2016", "Astro Boy (2003)" -> comparable key.
export function seriesKey(raw) {
  const key = String(raw || '')
    .toLowerCase()
    .replace(/[._\-]+/g, ' ')
    .replace(/[([]\s*(19|20)\d{2}\s*[)\]]/g, ' ') // (2003) / [2003]
    .replace(/\s(19|20)\d{2}\s*$/, ' ') // trailing year
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key || null;
}

// "Norsemen.S03E02.720p.WEBRip.srt" -> { seriesKey: 'norsemen', season: 3, episode: 2 }
export function parseEpisodeFilename(name) {
  const base = String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(VIDEO_OR_SUB_EXT, '');
  const match = base.match(SXXEYY) || base.match(NXNN);
  if (!match) return null;

  const key = seriesKey(match[1]);
  const season = Number(match[2]);
  const episode = Number(match[3]);
  if (!key || !Number.isInteger(season) || !Number.isInteger(episode) || episode < 1) return null;

  return { seriesKey: key, season, episode };
}

const isManual = guess => guess && guess.reason === 'User selected';

/**
 * @param {object} args
 * @param {string} args.changedPath  path of the file the user just changed
 * @param {object} args.newGuess     the guess the user picked for it
 * @param {Array<{path: string, name: string}>} args.files  every file that holds a guess
 * @param {object} args.movieGuesses current guesses, keyed by path
 * @returns {object} path -> new guess, for the files to update (may be empty)
 */
export function propagateShowToSiblings({ changedPath, newGuess, files, movieGuesses = {} }) {
  if (!newGuess || String(newGuess.kind || '').toLowerCase() !== 'episode') return {};

  const showImdb = newGuess.parent_imdbid || newGuess.series_imdb_id || null;
  if (!showImdb) return {};

  const changed = files.find(f => f.path === changedPath);
  const origin = changed && parseEpisodeFilename(changed.name);
  if (!origin) return {};

  const showTitle = newGuess.show_title || newGuess.title || '';
  const updates = {};

  files.forEach(file => {
    if (file.path === changedPath) return;
    if (isManual(movieGuesses[file.path])) return;

    const parsed = parseEpisodeFilename(file.name);
    if (!parsed || parsed.seriesKey !== origin.seriesKey) return;

    const { season, episode } = parsed;
    updates[file.path] = {
      imdbid: showImdb,
      parent_imdbid: showImdb,
      series_imdb_id: showImdb,
      title: showTitle,
      show_title: showTitle,
      year: newGuess.year ?? null,
      kind: 'episode',
      // No feature_id: the upload sends (show, season, episode) and the server
      // resolves the episode, creating it from IMDb when needed.
      feature_id: null,
      season,
      episode,
      season_number: season,
      episode_number: episode,
      episode_title: `Episode ${episode}`,
      formatted_title: `${showTitle} - S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
      provisional: false,
      reason: `Same show as ${changed.name}`,
      propagated_from: changedPath,
    };
  });

  return updates;
}

// ---------------------------------------------------------------------------
// Movies: the same idea, by title and year.
//
// Before: dropping two releases of "The Godfather" that the guess did not
// match meant searching (or creating the entry from its IMDb id) once per
// file. Now the first pick is enough: every other file whose name carries the
// same title and year gets that movie.
// ---------------------------------------------------------------------------

const YEAR = /(?:^|[\s._\-[(])((?:19|20)\d{2})(?=$|[\s._\-\])])/;

// "The.Godfather.1972.1080p.BrRip.x264.BOKUTOX.YIFY.en.srt"
//   -> { titleKey: 'the godfather', year: 1972 }
// A name without a year gives null: the title alone is too weak a key (the
// tags after it are not cut reliably), and no sibling is touched.
export function parseMovieFilename(name) {
  const base = String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(VIDEO_OR_SUB_EXT, '');
  if (!base || parseEpisodeFilename(base)) return null;

  const match = base.match(YEAR);
  if (match) {
    const titleKey = seriesKey(base.slice(0, match.index));
    if (!titleKey) return null;
    return { titleKey, year: Number(match[1]) };
  }
  return null;
}

const isObjectGuess = guess => guess && typeof guess === 'object';
// Never overwrite a pick made by hand or a match by video hash. A guess that
// came from an earlier propagation follows the newer pick.
const PROTECTED_REASONS = new Set([
  'User selected',
  'User created provisional entry',
  'User confirmed entry from IMDb/TMDb id',
  'Matched existing entry by IMDb/TMDb id',
  'Video hash match',
]);
const isProtected = guess =>
  isObjectGuess(guess) && guess.propagated_from == null && PROTECTED_REASONS.has(guess.reason);

/**
 * @param {object} args
 * @param {string} args.changedPath  path of the file the user just changed
 * @param {object} args.newGuess     the movie the user picked or created for it
 * @param {Array<{path: string, name: string}>} args.files  every file that holds a guess
 * @param {object} args.movieGuesses current guesses, keyed by path
 * @returns {object} path -> new guess, for the files to update (may be empty)
 */
export function propagateMovieToSiblings({ changedPath, newGuess, files, movieGuesses = {} }) {
  if (!isObjectGuess(newGuess)) return {};
  if (String(newGuess.kind || '').toLowerCase() !== 'movie') return {};
  if (!newGuess.imdbid && !newGuess.feature_id) return {};

  const changed = files.find(f => f.path === changedPath);
  const origin = changed && parseMovieFilename(changed.name);
  if (!origin) return {};

  const updates = {};
  files.forEach(file => {
    if (file.path === changedPath) return;
    const current = movieGuesses[file.path];
    // A filename guess still running would overwrite the update when it ends.
    if (current === 'guessing') return;
    if (isProtected(current)) return;

    const parsed = parseMovieFilename(file.name);
    if (!parsed || parsed.titleKey !== origin.titleKey || parsed.year !== origin.year) return;

    // Already on this movie: nothing to change.
    if (isObjectGuess(current) && current.imdbid && current.imdbid === newGuess.imdbid) return;

    const { reason: _reason, ...movie } = newGuess;
    updates[file.path] = {
      ...movie,
      reason: `Same movie as ${changed.name}`,
      propagated_from: changedPath,
    };
  });

  return updates;
}
