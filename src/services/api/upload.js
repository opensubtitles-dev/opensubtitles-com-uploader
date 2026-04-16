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
     * Returns: { feature_id, type, title, year, provisional, message }
     */
    async createStubFeature({ title, year, type }, opts = {}) {
      return client.post(
        '/subtitles/upload/features/stub',
        { title, year, type },
        { signal: opts.signal }
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Legacy-payload adapters — convert the XML-RPC-shaped payload assembled by
// subtitleUploadService.js into the flat REST payload the .com endpoint
// expects. These exist to keep the bulky upload-orchestration code in
// subtitleUploadService.js untouched while we swap the wire format.
//
// Legacy shapes:
//   tryUpload:  { subtitles: [ { subhash, subfilename, moviehash,
//                                moviebytesize, moviefilename, idmovieimdb,
//                                movietimems?, moviefps?, movieframes? } ] }
//   commit:     { baseinfo: { idmovieimdb, moviereleasename, movieaka,
//                             sublanguageid, subauthorcomment,
//                             hearingimpaired, highdefinition,
//                             automatictranslation, subtranslator,
//                             foreignpartsonly },
//                 cd1: { subhash, subfilename, moviehash, moviebytesize,
//                        moviefilename, subcontent, movietimems?,
//                        moviefps?, movieframes? },
//                 subcontent: <base64-gzip> }    (top-level mirror)
//
// REST flat shape (per docs/plans/02-endpoint-mapping.md §E10):
//   { subhash, subfilename, subcontent?, moviehash?, moviebytesize?,
//     moviefilename?, idmovieimdb?, tmdbid?, feature_id?,
//     movietimems?, moviefps?, movieframes?,
//     sublanguageid?, release_name?, movie_aka?, translator?,
//     author_comments?, hearing_impaired?, high_definition?,
//     foreign_parts_only?, automatic_translation?, machine_translated?,
//     guessit?, video_metadata? }
// ---------------------------------------------------------------------------

const toBool01 = v => v === '1' || v === 1 || v === true;

/**
 * Adapt a legacy XML-RPC tryUpload payload (`{subtitles:[{...}]}`) to the
 * REST /check shape. Always uses the first subtitle entry.
 */
export function adaptLegacyCheckPayload(legacy) {
  const sub = legacy?.subtitles?.[0] || {};
  return {
    subhash: sub.subhash,
    subfilename: sub.subfilename,
    moviehash: sub.moviehash,
    moviebytesize: sub.moviebytesize ? Number(sub.moviebytesize) : undefined,
    moviefilename: sub.moviefilename,
    idmovieimdb: sub.idmovieimdb,
    movietimems: sub.movietimems ? Number(sub.movietimems) : undefined,
    moviefps: sub.moviefps ? Number(sub.moviefps) : undefined,
    movieframes: sub.movieframes ? Number(sub.movieframes) : undefined,
    sublanguageid: sub.sublanguageid,
  };
}

/**
 * Adapt a legacy XML-RPC commit payload (`{baseinfo, cd1, subcontent}`) to
 * the REST /upload shape.
 */
export function adaptLegacyCommitPayload(legacy) {
  const baseinfo = legacy?.baseinfo || {};
  const cd1 = legacy?.cd1 || {};
  return {
    subhash: cd1.subhash,
    subfilename: cd1.subfilename,
    subcontent: cd1.subcontent || legacy?.subcontent,
    moviehash: cd1.moviehash,
    moviebytesize: cd1.moviebytesize ? Number(cd1.moviebytesize) : undefined,
    moviefilename: cd1.moviefilename,
    movietimems: cd1.movietimems ? Number(cd1.movietimems) : undefined,
    moviefps: cd1.moviefps ? Number(cd1.moviefps) : undefined,
    movieframes: cd1.movieframes ? Number(cd1.movieframes) : undefined,

    idmovieimdb: baseinfo.idmovieimdb,
    sublanguageid: baseinfo.sublanguageid,
    release_name: baseinfo.moviereleasename,
    movie_aka: baseinfo.movieaka || '',
    translator: baseinfo.subtranslator || '',
    author_comments: baseinfo.subauthorcomment || '',
    hearing_impaired: toBool01(baseinfo.hearingimpaired),
    high_definition: toBool01(baseinfo.highdefinition),
    foreign_parts_only: toBool01(baseinfo.foreignpartsonly),
    automatic_translation: toBool01(baseinfo.automatictranslation),
    machine_translated: toBool01(baseinfo.machinetranslated),
  };
}

/**
 * Map a REST /check response back into the XML-RPC-shaped envelope that the
 * legacy subtitleUploadService.processUpload code reads:
 *   { status: '200 OK' | error, alreadyindb: 0|1, data: <url|null>, ... }
 *
 * Preserves the raw REST envelope under `_rest` for any new code that wants
 * the structured data (quota, flags_suggested, rejection_reasons).
 */
export function restCheckResponseToLegacy(rest) {
  if (!rest || typeof rest !== 'object') return { status: 'unknown', alreadyindb: 0 };
  const url = rest?.feature?.url || null;
  return {
    status: '200 OK',
    alreadyindb: rest.already_in_db ? 1 : 0,
    data: rest.already_in_db ? url || String(rest.duplicate_of || '') : null,
    duplicate_of: rest.duplicate_of || null,
    feature: rest.feature || null,
    flags_suggested: rest.flags_suggested || null,
    quota: rest.quota || null,
    would_be_rejected: rest.would_be_rejected || false,
    rejection_reasons: rest.rejection_reasons || [],
    _rest: rest,
  };
}

/**
 * Map a REST /upload commit response into the legacy envelope shape.
 */
export function restCommitResponseToLegacy(rest) {
  if (!rest || typeof rest !== 'object') return { status: 'unknown', alreadyindb: 0 };
  return {
    status: '200 OK',
    alreadyindb: 0,
    data: rest.download_url || String(rest.subtitle_id || ''),
    subtitle_id: rest.subtitle_id || null,
    subfile_id: rest.subfile_id || null,
    feature_id: rest.feature_id || null,
    download_url: rest.download_url || null,
    flags_applied: rest.flags_applied || [],
    warnings: rest.warnings || [],
    quota: rest.quota || null,
    review_status: rest.status || null,  // 'created' | 'flagged_for_review'
    _rest: rest,
  };
}

/** Default singleton — most callers use this. */
export const uploadApi = createUploadApi();
