/**
 * Auth REST endpoints — wraps POST /login, DELETE /logout, GET /infos/user.
 *
 * See docs/plans/02-endpoint-mapping.md §E1, §E2, §E3 and
 *     docs/plans/03-auth-migration.md §A1, §A2, §A3.
 *
 * Server contracts (verified against osdb3 Rails source 2026-04-15):
 *   POST /login   → { user: {...}, token, status: 200, base_url }
 *   DELETE /logout → { message, status }   (best-effort; client clears regardless)
 *   GET /infos/user → { data: {...} }      (Bearer required; 401 if expired)
 *
 * Anonymous calls just omit `Authorization` — Api-Key header is always sent.
 */

import { restClient as defaultClient } from './restClient.js';

/**
 * @param {object} deps
 * @param {object} [deps.client]   restClient-shaped (.post/.get/.delete). Defaults to the singleton.
 */
export function createAuthApi({ client = defaultClient } = {}) {
  return {
    /**
     * POST /login — plaintext password over HTTPS (no MD5 hashing).
     *
     * On 200 returns the canonical envelope:
     *   { user: { user_id, level, vip, allowed_downloads, allowed_translations,
     *             ext_installed }, token, status: 200, base_url }
     *
     * On 401 the server returns { message: "Error, invalid username/password
     * failed:N remaining:M ...", status: 401 }. The restClient surfaces this
     * as `RestError(http_401|unauthorized)` with `details.message` populated.
     *
     * Note: this endpoint must be called with `authenticated: false` so the
     * client doesn't attach a stale Bearer header.
     */
    async login({ username, password }) {
      return client.post('/login', { username, password }, { authenticated: false });
    },

    /**
     * DELETE /logout — best-effort. The server revokes ALL JWTs for the user
     * across all clients (KongUtilsFaraday.delete_all_jwt). Errors are
     * non-fatal: the client should clear local state regardless.
     */
    async logout() {
      try {
        return await client.delete('/logout');
      } catch (err) {
        // 401 means the token was already invalid — fine
        // 404 means the endpoint doesn't exist on this server build — also fine
        if (err?.status === 401 || err?.status === 404) {
          return { message: err?.message ?? 'logout best-effort', status: err.status };
        }
        // Anything else is unexpected; log but don't propagate — caller will
        // still clear local state.
        // eslint-disable-next-line no-console
        console.warn('[authApi] /logout failed (non-fatal):', err);
        return { message: err?.message ?? 'logout best-effort', status: 0 };
      }
    },

    /**
     * GET /infos/user — full user profile + quota. Requires Bearer.
     * Returns `{ data: {...} }` on 200, throws AuthError on 401.
     */
    async getUserInfo() {
      const response = await client.get('/infos/user');
      // Server sometimes returns { data: {...} }, sometimes the user object directly.
      // Be permissive.
      return response?.data ?? response ?? null;
    },
  };
}

/** Default singleton. */
export const authApi = createAuthApi();
