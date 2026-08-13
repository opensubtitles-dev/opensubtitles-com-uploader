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

    // TV episode coords — set when the backend matched a Tvshow parent with
    // guessit-derived S/E numbers (per /guess controller). Empty for movies.
    season_number: best.season_number != null ? Number(best.season_number) : null,
    episode_number: best.episode_number != null ? Number(best.episode_number) : null,

    // Parent (TV show) carry-through — Rails attaches these on episode
    // matches so the UI can render "Show title" + "SxxExx – Episode" and
    // a parent-show IMDb link without a follow-up /features round-trip.
    show_title: best.parent_title || null,
    parent_imdb_id:
      best.parent_imdb_id != null ? `tt${String(best.parent_imdb_id).padStart(7, '0')}` : null,
    parent_year: best.parent_year != null ? Number(best.parent_year) : null,
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

    /**
     * POST /subtitles/upload — commit the actual subtitle.
     *
     * Server returns:
     *   { subtitle_id, feature_id, subfile_id, download_url,
     *     status: 'created' | 'flagged_for_review',
     *     flags_applied: [...], warnings: [...], quota: {...} }
     *
     * On 409 (race-window duplicate) the restClient surfaces RestError with
     * `code: 'duplicate'` and `details.duplicate_of` populated.
     */
    async commit(payload, opts = {}) {
      return client.post('/subtitles/upload', payload, {
        signal: opts.signal,
        authenticated: opts.anonymous === true ? false : 'auto',
      });
    },

    /**
     * POST /subtitles/upload/features/stub — provisional feature creation
     * for the "movie not in IMDb/TMDb" flow. Requires JWT (logged-in user).
     *
     * Manual flow: pass { title, year, type } only — server defaults
     * `source` to "manual" and the feature lands without external ids.
     *
     * Resolved-from-id flow (after /features/from_id + user confirmation):
     * pass `imdb_id`, optionally `tmdb_id`, and `source: 'imdb' | 'tmdb'`
     * so the feature row carries the canonical external id from creation.
     * For episodes, pass `parent_imdbid` or `parent_feature_id` when known
     * so the new row can stay attached to its series.
     * The server uses imdb_id (or tmdb_id + type) as the dedup key — a
     * retry with the same id returns 409 + the existing feature_id
     * instead of inserting a duplicate row.
     *
     * Returns: { feature_id, type, title, year, imdbid, tmdbid, source,
     *           provisional, message }
     */
    async createStubFeature(
      {
        title,
        year,
        type,
        imdb_id,
        tmdb_id,
        source,
        season,
        episode,
        parent_imdbid,
        parent_feature_id,
      } = {},
      opts = {}
    ) {
      const body = { title, year, type };
      if (imdb_id != null && imdb_id !== '' && imdb_id !== 0) body.imdb_id = imdb_id;
      if (tmdb_id != null && tmdb_id !== '' && tmdb_id !== 0) body.tmdb_id = tmdb_id;
      if (season != null && season !== '' && season !== 0) body.season = season;
      if (episode != null && episode !== '' && episode !== 0) body.episode = episode;
      if (parent_imdbid != null && parent_imdbid !== '' && parent_imdbid !== 0) {
        body.parent_imdbid = parent_imdbid;
      }
      if (parent_feature_id != null && parent_feature_id !== '' && parent_feature_id !== 0) {
        body.parent_feature_id = parent_feature_id;
      }
      if (source) body.source = source;
      return client.post('/subtitles/upload/features/stub', body, { signal: opts.signal });
    },

    /**
     * POST /subtitles/upload/features/from_id — resolve an IMDb / TMDb id
     * to canonical metadata so the uploader can render a confirm step
     * before creating a feature.
     *
     * See osdb3 plan: docs/plans/2026-05-07-stub-feature-from-imdb-tmdb.md
     * and this repo's docs/plans/11-stub-feature-from-imdb-tmdb.md.
     *
     * Accepts either or both ids. The server prefers imdb_id when both
     * are present (resolved §3 — IMDb wins). Anonymous is OK; sends
     * Bearer when present so admin/VIP-only blacklisted features can
     * still resolve.
     *
     * Returns the server envelope verbatim:
     *   on found (movie):
     *     { found: true, source: 'imdb'|'tmdb', imdb_id, tmdb_id,
     *       title, original_title, year, type: 'movie',
     *       poster_url, exists_in_db: false, feature_id: null }
     *   on found (tvshow — uploads must never target series-level, so
     *     the body always carries the full season/episode graph):
     *     { found: true, source: 'imdb', imdb_id, title, year,
     *       type: 'tvshow', exists_in_db, feature_id, poster_url,
     *       series: { seasons: [{ season_number, episode_count,
     *         episodes: [{ imdb_id, episode_number, title, year,
     *         runtime_seconds }] }] } }
     *   on found (episode normalised to show + preselected coords):
     *     <tvshow body> + preselected: { season_number, episode_number,
     *       imdb_id, title }
     *   on exists_in_db:
     *     { found: true, exists_in_db: true, feature_id, imdb_id,
     *       tmdb_id, title, year, type }
     *   on 404:
     *     RestError with code 'imdb_id_not_found' | 'tmdb_id_not_found'
     *   on 422:
     *     RestError with code 'invalid_imdb_id' | 'invalid_tmdb_id'
     *       | 'missing_id'
     */
    async resolveFromId({ imdbId, tmdbId } = {}, opts = {}) {
      const body = {};
      // Treat 0, '', null, undefined as absent — neither is a valid id.
      if (imdbId != null && imdbId !== '' && imdbId !== 0) body.imdb_id = imdbId;
      if (tmdbId != null && tmdbId !== '' && tmdbId !== 0) body.tmdb_id = tmdbId;
      return client.post('/subtitles/upload/features/from_id', body, {
        signal: opts.signal,
        authenticated: opts.anonymous === true ? false : 'auto',
      });
    },
  };
}

// ---------------------------------------------------------------------------
// (Phase E step 5, 2026-05-06) — Legacy XML-RPC payload + response adapters
// removed.
//
// `subtitleUploadService.js` previously emitted `{ subtitles: [...] }` /
// `{ baseinfo, cd1, subcontent }` envelopes and we adapted them to/from the
// flat REST shape via four functions here:
//   - adaptLegacyCheckPayload
//   - adaptLegacyCommitPayload
//   - restCheckResponseToLegacy
//   - restCommitResponseToLegacy
// Steps 1–4 of the orchestration rewrite (see docs/plans/10-orchestration-rewrite.md)
// switched the orchestrator to emit and consume REST shape directly, so these
// are no longer reachable from any caller. Their unit tests in
// `tests/services/api/upload.test.js` were dropped in this same commit.
// Git history (commit `2b12f1d` and earlier `phase-e-step-*` commits) is the
// only place they still live, in case a future flow needs the legacy shape.
// ---------------------------------------------------------------------------

/** Default singleton — most callers use this. */
export const uploadApi = createUploadApi();
