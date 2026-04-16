/**
 * /api/v1/my/uploads — user's own upload history (list / edit / soft-delete).
 *
 * All endpoints require Bearer JWT. Anonymous users have no history because
 * anon uploads have uploader_id: nil server-side.
 *
 * See docs/plans/06-my-uploads-integration.md for the full UX + data flow.
 */

import { restClient as defaultClient } from './restClient.js';

/**
 * @param {object} deps
 * @param {object} [deps.client]   restClient-shaped (.get/.patch/.delete)
 */
export function createMyUploadsApi({ client = defaultClient } = {}) {
  return {
    /**
     * GET /my/uploads — paginated list of the current user's subtitles.
     *
     * @param {object} [opts]
     * @param {number} [opts.page=1]
     * @param {number} [opts.perPage=20]   1-50; clamped server-side
     * @param {string} [opts.languageCode] e.g. 'eng' — server filters by osdb_language
     * @param {boolean} [opts.enabled]     true = active, false = soft-deleted
     * @param {AbortSignal} [opts.signal]
     * @returns {Promise<{
     *   data: Array<object>,
     *   meta: { total_count: number, page: number, per_page: number, total_pages: number }
     * }>}
     */
    async list({ page = 1, perPage = 20, languageCode, enabled, signal } = {}) {
      const query = { page, per_page: perPage };
      if (languageCode) query.language_code = languageCode;
      if (enabled !== undefined) query.enabled = enabled;
      return client.get('/my/uploads', { query, signal });
    },

    /**
     * PATCH /my/uploads/:id — edit metadata. Server-side allowed fields:
     *   release_name, movie_aka, translator, author_comments,
     *   hearing_impaired, hd, foreign_parts_only,
     *   automatic_translation, machine_translated.
     *
     * @returns {Promise<{ subtitle_id: number, status: string, subtitle: object }>}
     */
    async update(id, patch, opts = {}) {
      return client.patch(`/my/uploads/${id}`, patch, { signal: opts.signal });
    },

    /**
     * DELETE /my/uploads/:id — soft-delete (sets enabled=false). Returns
     * `{ subtitle_id, status: 'deleted' }`.
     */
    async remove(id, opts = {}) {
      return client.delete(`/my/uploads/${id}`, { signal: opts.signal });
    },
  };
}

export const myUploadsApi = createMyUploadsApi();
