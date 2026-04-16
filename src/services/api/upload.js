/**
 * Upload REST endpoints — wraps the four `/subtitles/upload*` endpoints
 * that the OSDB3 Rails backend exposes.
 *
 *   POST /api/v1/subtitles/upload/guess          — filename → movie guess
 *   POST /api/v1/subtitles/upload/check          — pre-flight dedup + quota
 *   POST /api/v1/subtitles/upload                — commit
 *   POST /api/v1/subtitles/upload/features/stub  — provisional feature
 *
 * Currently implemented: guess. The other three land in subsequent steps
 * of the migration sequence (steps 6, 7, 9).
 */

import { restClient as defaultClient } from './restClient.js';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a guess `best_guess` (or array entry from `candidates`) into the
 * legacy shape that downstream code expects:
 *
 *   { imdbid, title, year, kind, reason, feature_id, tmdb_id }
 *
 * Legacy `imdbid` was either a tt-prefixed string or numeric — downstream
 * code copes with both. We emit the tt-prefixed string for visual stability.
 *
 * @param {object|null} best  best_guess object from server, or null
 * @param {string} [reason]   override the `reason` text
 */
export function normalizeGuessResult(best, reason) {
  if (!best || typeof best !== 'object') return null;

  const imdbNumeric = best.imdbid != null ? String(best.imdbid) : '';
  const imdbid = imdbNumeric ? `tt${imdbNumeric.padStart(7, '0')}` : null;

  const score = best.score != null ? Number(best.score) : null;
  const computedReason =
    reason ??
    (score != null && Number.isFinite(score)
      ? `Auto-guess (${Math.round(score * 100)}% confidence)`
      : 'Auto-guess');

  return {
    // Legacy shape — preserves compatibility with existing useMovieGuess /
    // MovieDisplay / setMovieGuess consumers
    imdbid,
    title: best.title || '',
    year: best.year != null ? Number(best.year) : null,
    kind: (best.type || '').toLowerCase(),
    reason: computedReason,

    // New richer fields
    feature_id: best.feature_id != null ? Number(best.feature_id) : null,
    tmdb_id: best.tmdbid != null ? Number(best.tmdbid) : null,
    score,
  };
}

// ---------------------------------------------------------------------------
// Factory + default singleton
// ---------------------------------------------------------------------------

/**
 * @param {object} deps
 * @param {object} [deps.client]   restClient-shaped (.post). Defaults to singleton.
 */
export function createUploadApi({ client = defaultClient } = {}) {
  return {
    /**
     * POST /subtitles/upload/guess — match a filename (and optional moviehash)
     * to a feature. Works anonymously (no Bearer required) but will use the
     * current JWT if one is present (for quota tracking).
     *
     * Returns the legacy-shape best_guess plus a richer `candidates` array.
     *
     * @param {string} filename
     * @param {string|null} [moviehash]   optional 16-hex moviehash
     * @param {{ signal?: AbortSignal, anonymous?: boolean }} [opts]
     * @returns {Promise<{
     *   best_guess: object|null,
     *   candidates: object[],
     *   raw: object
     * }>}
     */
    async guess(filename, moviehash = null, opts = {}) {
      const body = { filename: String(filename ?? '') };
      if (moviehash) body.moviehash = String(moviehash);

      const response = await client.post('/subtitles/upload/guess', body, {
        signal: opts.signal,
        // anonymous defaults to 'auto' so we send Bearer when available
        authenticated: opts.anonymous === true ? false : 'auto',
      });

      const best = normalizeGuessResult(response?.best_guess);
      const candidates = Array.isArray(response?.candidates)
        ? response.candidates.map(c => normalizeGuessResult(c)).filter(Boolean)
        : [];

      return { best_guess: best, candidates, raw: response };
    },

    /**
     * POST /subtitles/upload/check — pre-flight dedup + anti-abuse + quota.
     *
     * The server-side endpoint expects the FULL upload payload (subhash,
     * subfilename, sublanguageid, idmovieimdb/feature_id, ...) but runs the
     * subhash dedup BEFORE language/feature validation. So an early-stage
     * caller that only knows the subhash can probe with a placeholder
     * `sublanguageid: "eng"` and treat:
     *   - 200 + already_in_db: true   → real duplicate
     *   - 200 + already_in_db: false  → not a duplicate
     *   - 4xx invalid_language / feature_not_found / validation_error
     *                                  → other fields incomplete; treat as
     *                                    "not yet known" rather than as a
     *                                    failure of dedup
     *
     * Returns the parsed server envelope, including:
     *   { already_in_db, duplicate_of, feature, would_be_rejected,
     *     rejection_reasons, flags_suggested, quota }
     *
     * @param {object}  payload          full or partial upload payload
     * @param {object}  [opts]
     * @param {boolean} [opts.anonymous] omit Bearer (default: send if present)
     * @param {AbortSignal} [opts.signal]
     */
    async check(payload, opts = {}) {
      // Strip subcontent — /check never needs it (the commit endpoint does).
      const { subcontent: _subcontent, ...checkPayload } = payload || {};
      return client.post('/subtitles/upload/check', checkPayload, {
        signal: opts.signal,
        authenticated: opts.anonymous === true ? false : 'auto',
      });
    },
  };
}

/** Default singleton — most callers use this. */
export const uploadApi = createUploadApi();
