/**
 * User data adapter — maps the REST `/login` and `/infos/user` responses
 * into a unified shape that exposes BOTH:
 *   1. The new fields (`username`, `level`, `user_id`, `vip`, ...)
 *   2. The legacy XML-RPC field names (`UserNickName`, `UserRank`, `IDUser`, ...)
 *
 * The legacy field names are still consumed by several components
 * (UserProfile.jsx, RankRestrictionWarning.jsx, ConfigOverlay.jsx,
 * useUserSession.js). Synthesizing them here means we can swap auth without
 * touching every consumer.
 *
 * See docs/plans/03-auth-migration.md §13.2.
 */

/**
 * @typedef {Object} RestUser  REST `/login` response → `user` field, also
 *                              the body of GET /infos/user (data field).
 * @property {string} [username]                 echoed from login request only
 * @property {string|number} [user_id]
 * @property {string} [level]                    e.g. "Sub leecher"
 * @property {boolean} [vip]
 * @property {number} [allowed_downloads]
 * @property {number} [allowed_translations]
 * @property {boolean} [ext_installed]
 */

/**
 * Build the unified user object from the REST shape + the original username
 * the user typed (or null for restored sessions).
 *
 * @param {RestUser|null|undefined} restUser
 * @param {{ username?: string|null, baseUrl?: string|null }} [extra]
 * @returns {object|null}
 */
export function adaptRestUser(restUser, extra = {}) {
  if (!restUser || typeof restUser !== 'object') return null;

  const username  = extra.username ?? restUser.username ?? null;
  const userId    = restUser.user_id != null ? String(restUser.user_id) : null;
  const level     = restUser.level || '';

  return {
    // -------- New canonical fields --------
    username,
    user_id:              userId ? Number(userId) : null,
    level,
    vip:                  Boolean(restUser.vip),
    allowed_downloads:    Number(restUser.allowed_downloads ?? 0),
    allowed_translations: Number(restUser.allowed_translations ?? 0),
    ext_installed:        Boolean(restUser.ext_installed),
    base_url:             extra.baseUrl ?? null,

    // -------- Legacy XML-RPC field names (back-compat) --------
    // Components that read these keep working without modification.
    UserNickName: username || '',
    UserRank:     level,
    UserRanks:    level ? [level] : [],
    IDUser:       userId,
    UploadCnt:    0,   // not exposed by .com REST; default 0
    DownloadCnt:  0,   // not exposed by .com REST; default 0
    UserPreferedLanguages: '',
  };
}

/**
 * Merge an adapted user with refreshed `/infos/user` data, preserving the
 * original `username` (which only the login request echoes — `/infos/user`
 * doesn't return it in jwt_payload).
 */
export function mergeRefreshedUser(existing, restUser) {
  if (!existing) return adaptRestUser(restUser);
  if (!restUser) return existing;
  return adaptRestUser(restUser, {
    username: existing.username,
    baseUrl:  existing.base_url,
  });
}
