// IMDb title search rows (GET /subtitles/upload/features/lookup) in the
// title search box.
//
// /features only finds titles already on OpenSubtitles, so a film nobody has
// uploaded to yet could be added only by pasting its IMDb id. The lookup
// searches IMDb's own list of movies and series; its rows are listed after
// our own results, and picking one we do not have yet opens the same
// confirm/create dialog as a pasted id.

export const IMDB_LOOKUP_SOURCE = 'imdb';

/**
 * Server row -> the search-row shape the result list and handleMovieSelect
 * read (same fields as normalizeFeatureForUi).
 *
 * @param {object} row { imdb_id: "tt0068646", title, original_title, year, type, votes, feature_id }
 */
export function imdbLookupRowToSearchRow(row) {
  if (!row || typeof row !== 'object' || !row.imdb_id) return null;
  const ttId = String(row.imdb_id);
  const numeric = Number(ttId.replace(/^tt/i, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  return {
    id: ttId,
    name: row.title || '',
    title: row.title || '',
    original_title: row.original_title || '',
    year: row.year != null ? Number(row.year) : null,
    kind: (row.type || 'movie').toLowerCase(),
    feature_id: row.feature_id != null ? Number(row.feature_id) : null,
    imdb_id: numeric,
    tmdb_id: null,
    img_url: '',
    url: '',
    parent_imdb_id: null,
    season_number: null,
    episode_number: null,
    votes: row.votes != null ? Number(row.votes) : null,
    source: IMDB_LOOKUP_SOURCE,
  };
}

/** A row from the IMDb lookup that is not in our database yet. */
export function isNewImdbRow(row) {
  return Boolean(row && row.source === IMDB_LOOKUP_SOURCE && !row.feature_id);
}

/**
 * Our own results first, then the IMDb rows they do not already list.
 *
 * @param {object[]} localRows rows from /features
 * @param {object[]} imdbRows  rows from imdbLookupRowToSearchRow
 */
export function mergeSearchResults(localRows = [], imdbRows = []) {
  const seen = new Set(
    localRows.map(r => (r?.imdb_id != null ? Number(r.imdb_id) : null)).filter(Boolean)
  );
  const extra = imdbRows.filter(r => r && !seen.has(Number(r.imdb_id)));
  return [...localRows, ...extra];
}
