/**
 * Features API — REST replacement for two legacy paths:
 *   - `https://www.opensubtitles.org/libs/suggest_imdb.php?m=...` (movie autocomplete)
 *   - `XmlRpcService.searchMovies()` (dead code, never called)
 *
 * Endpoint: GET /api/v1/features
 *   Params: query | imdb_id | tmdb_id | feature_id | type (movie|tvshow|episode)
 *
 * Response:
 *   { data: [ { id, type: "feature", attributes: {
 *       title, original_title, year, feature_type, feature_id,
 *       imdb_id, tmdb_id, parent_imdb_id, img_url, url, ...
 *     } }, ... ] }
 *
 * This module also exposes a `normalizeFeatureForUi(rawAttributes)` helper that
 * flattens the response into the shape `useMovieSearch` + the upload pipeline
 * already expect (so the swap doesn't require touching downstream callers).
 *
 * See docs/plans/02-endpoint-mapping.md §E6 + §E7.
 */

import { restClient as defaultClient } from './restClient.js';
import { CACHE_PREFIXES } from '../../utils/storageKeys.js';

const SEARCH_CACHE_TTL_MS  = 24 * 60 * 60 * 1000;       // 1 day
const IMDB_CACHE_TTL_MS    = 7  * 24 * 60 * 60 * 1000;  // 7 days

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Strip "tt" prefix and leading zeros from an IMDB id.
 * "tt0133093" → "133093"; "tt1133589" → "1133589"; 1234 → "1234"
 */
export function imdbIdToNumeric(imdbId) {
  if (imdbId === null || imdbId === undefined) return '';
  const trimmed = String(imdbId).trim();
  if (trimmed === '') return '';
  const cleaned = trimmed.toLowerCase().replace(/^tt0*/, '').replace(/^0+/, '');
  // After stripping, an all-zero input collapses to '' — preserve as '0' so
  // the caller can distinguish "non-empty but invalid" from "empty input".
  return cleaned === '' ? '0' : cleaned;
}

/**
 * Normalize a single feature item into the shape expected by useMovieSearch +
 * the upload pipeline. The legacy `suggest_imdb.php` returned shape was:
 *
 *   { id: "tt0133093", name: "The Matrix", year: "1999", kind: "movie" }
 *
 * Downstream code (`handleMovieSelect`) reads `id`, `name`, `year`, `kind`
 * and produces a movie-guess `{ imdbid: movie.id, title: movie.name, year, kind }`.
 *
 * We preserve those legacy fields AND attach richer metadata (`feature_id`,
 * `imdb_id` numeric, `tmdb_id`, `img_url`) so new code can use the better data.
 */
export function normalizeFeatureForUi(item) {
  const a = item?.attributes ?? {};
  const imdbNumeric = a.imdb_id != null ? String(a.imdb_id) : '';
  const ttId = imdbNumeric ? `tt${imdbNumeric.padStart(7, '0')}` : '';
  return {
    // Legacy shape (kept for back-compat with handleMovieSelect)
    id:    ttId,
    name:  a.original_title || a.title || '',
    year:  a.year ? Number(a.year) : null,
    kind:  (a.feature_type || '').toLowerCase(),

    // Richer fields for new code
    feature_id:  a.feature_id != null ? Number(a.feature_id) : (item?.id ? Number(item.id) : null),
    imdb_id:     imdbNumeric ? Number(imdbNumeric) : null,
    tmdb_id:     a.tmdb_id != null ? Number(a.tmdb_id) : null,
    title:       a.title || '',
    original_title: a.original_title || '',
    img_url:     a.img_url || '',
    url:         a.url || '',
    parent_imdb_id: a.parent_imdb_id != null ? Number(a.parent_imdb_id) : null,
    season_number: a.season_number ?? null,
    episode_number: a.episode_number ?? null,
  };
}

/**
 * Take the raw `restClient.get('/features', ...)` body and return an array of
 * normalized features. Always returns an array; never throws.
 */
export function normalizeFeaturesResponse(response) {
  const list = Array.isArray(response?.data) ? response.data : [];
  return list.map(normalizeFeatureForUi);
}

// ---------------------------------------------------------------------------
// Factory + default singleton
// ---------------------------------------------------------------------------

/**
 * @param {object}   deps
 * @param {object}   deps.client               restClient-shaped (.get)
 * @param {object}   [deps.cache]              CacheService-shaped (loadFromCache/saveToCache/clearCache)
 */
export function createFeaturesApi({ client, cache }) {
  function loadCache(key) {
    if (!cache) return null;
    return cache.loadFromCache(key);
  }
  function writeCache(key, data, ttlMs) {
    if (!cache) return;
    cache.saveToCache(key, data, `max-age=${Math.floor(ttlMs / 1000)}`);
  }

  return {
    /**
     * Search features by free-text query. Returns up to ~25 results from the
     * .com features index, normalized to the legacy autocomplete shape +
     * richer metadata for the new code paths.
     *
     * @param {string} query
     * @param {{ type?: 'movie'|'tvshow'|'episode', signal?: AbortSignal }} [opts]
     * @returns {Promise<{ data: Array<NormalizedFeature>, fromCache: boolean }>}
     */
    async searchByQuery(query, opts = {}) {
      const trimmed = String(query ?? '').trim();
      if (!trimmed) return { data: [], fromCache: false };

      const key = `${CACHE_PREFIXES.FEATURES_QUERY}${trimmed.toLowerCase()}::${opts.type || 'all'}`;
      const cached = loadCache(key);
      if (cached) return { data: cached, fromCache: true };

      const queryParams = { query: trimmed };
      if (opts.type) queryParams.type = opts.type;

      const response = await client.get('/features', {
        query: queryParams,
        signal: opts.signal,
        authenticated: false,
      });
      const data = normalizeFeaturesResponse(response);
      writeCache(key, data, SEARCH_CACHE_TTL_MS);
      return { data, fromCache: false };
    },

    /**
     * Look up a feature by IMDB id. Accepts "tt0133093", "0133093", "133093",
     * or a number — anything `imdbIdToNumeric()` can chew on.
     *
     * @returns {Promise<{ data: Array<NormalizedFeature>, fromCache: boolean }>}
     */
    async byImdbId(imdbId, opts = {}) {
      const numeric = imdbIdToNumeric(imdbId);
      if (!numeric || numeric === '0') return { data: [], fromCache: false };

      const key = `${CACHE_PREFIXES.FEATURES_IMDB}${numeric}`;
      const cached = loadCache(key);
      if (cached) return { data: cached, fromCache: true };

      const response = await client.get('/features', {
        query: { imdb_id: numeric },
        signal: opts.signal,
        authenticated: false,
      });
      const data = normalizeFeaturesResponse(response);
      writeCache(key, data, IMDB_CACHE_TTL_MS);
      return { data, fromCache: false };
    },

    _clearCacheByQuery(query, type = 'all') {
      if (!cache) return;
      cache.clearCache(`${CACHE_PREFIXES.FEATURES_QUERY}${query.toLowerCase()}::${type}`);
    },

    _clearCacheByImdbId(imdbId) {
      if (!cache) return;
      cache.clearCache(`${CACHE_PREFIXES.FEATURES_IMDB}${imdbIdToNumeric(imdbId)}`);
    },
  };
}

// Lazy default — same pattern as languages.js to avoid loading cache.js (and
// therefore pako) during pure-unit-test imports.
let _defaultApi = null;
async function _getDefault() {
  if (_defaultApi) return _defaultApi;
  const { CacheService } = await import('../cache.js');
  _defaultApi = createFeaturesApi({ client: defaultClient, cache: CacheService });
  return _defaultApi;
}

export const featuresApi = {
  async searchByQuery(query, opts) { return (await _getDefault()).searchByQuery(query, opts); },
  async byImdbId(imdbId, opts)     { return (await _getDefault()).byImdbId(imdbId, opts); },
  async _clearCacheByQuery(q, t)   { return (await _getDefault())._clearCacheByQuery(q, t); },
  async _clearCacheByImdbId(id)    { return (await _getDefault())._clearCacheByImdbId(id); },
};
