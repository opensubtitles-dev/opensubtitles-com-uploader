/**
 * Canonical localStorage key names for the .com REST era.
 *
 * All new keys use the `osdb_com_` prefix to avoid any collision with the
 * legacy `opensubtitles_*` + `opensubtitles_xmlrpc_*` keys written by the
 * .org XML-RPC flow. On first launch of the migrated app, the legacy keys
 * are deleted by `migrateLegacyKeys()`.
 *
 * See docs/plans/03-auth-migration.md §5 and docs/plans/04-rest-client-refactor.md §8.
 */

import { getActiveEnvironmentId, BACKEND_PREF_KEY } from '../config/environments.js';

/**
 * Auth keys, scoped to a backend environment.
 *
 * The environment id is an INFIX, not a suffix: 'osdb_com_dev_jwt', not
 * 'osdb_com_jwt:dev'. That keeps the osdb_com_ prefix contract intact and,
 * for the cache keys below, keeps the '_expiry' suffix at the end where
 * cache.js's endsWith() filters expect it.
 *
 * Exported as a pure builder so tests can check both environments without
 * module-cache tricks.
 */
export const buildStorageKeys = envId =>
  Object.freeze({
    JWT: `osdb_com_${envId}_jwt`,
    USER: `osdb_com_${envId}_user`,
    LOGIN_TIME: `osdb_com_${envId}_login_time`,
    // Cosmetic "remember last username" — identical across environments
    REMEMBERED_USERNAME: 'opensubtitles_remembered_username',
    // Migration markers — global by definition
    MIGRATION_V2_DONE: 'osdb_migration_v2_done',
    MIGRATION_V3_DONE: 'osdb_migration_v3_done',
    // The environment selector itself. Never scoped — it is what chooses
    // the scope. Owned by config/environments.js.
    BACKEND_PREF: BACKEND_PREF_KEY,
  });

export const buildCachePrefixes = envId =>
  Object.freeze({
    LANGUAGES: `rest_${envId}_languages_cache`,
    FEATURES_IMDB: `rest_${envId}_features_cache:imdb:`,
    FEATURES_QUERY: `rest_${envId}_features_cache:query:`,
    MOVIE_GUESS: `rest_${envId}_movie_guess_cache:`,
    CHECK: `rest_${envId}_check_cache:`,
    LANG_DETECT: `rest_${envId}_lang_detect_cache:`,
    GUESSIT: `rest_${envId}_guessit_cache:`,
  });

export const STORAGE_KEYS = buildStorageKeys(getActiveEnvironmentId());
export const CACHE_PREFIXES = buildCachePrefixes(getActiveEnvironmentId());

/**
 * Legacy keys from the .org XML-RPC era. Deleted on first launch.
 */
export const LEGACY_KEYS = Object.freeze([
  'opensubtitles_token',
  'opensubtitles_user_data',
  'opensubtitles_login_time',
  'opensubtitles_session_id',
  // Cache keys that held XML-RPC-shaped data (would mislead REST parsers)
  'opensubtitles_xmlrpc_languages_cache',
  'opensubtitles_xmlrpc_languages_cache_expiry',
  'opensubtitles_xmlrpc_checksub_cache',
  'opensubtitles_xmlrpc_checksub_cache_expiry',
  'opensubtitles_movie_guess_cache',
  'opensubtitles_movie_guess_cache_expiry',
]);

/**
 * One-shot purge of legacy keys. Idempotent — the marker prevents re-runs.
 *
 * Call at app startup (before any auth / cache code that might read these
 * legacy keys). Safe to call multiple times.
 *
 * @param {Storage} [storage=localStorage] injectable for tests
 * @returns {boolean} true if migration ran, false if it was already done
 */
export function migrateLegacyKeys(storage) {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return false;

  try {
    if (store.getItem(STORAGE_KEYS.MIGRATION_V2_DONE)) return false;
    for (const key of LEGACY_KEYS) {
      try {
        store.removeItem(key);
      } catch {
        // best-effort: ignore individual key errors
      }
    }
    store.setItem(STORAGE_KEYS.MIGRATION_V2_DONE, '1');
    return true;
  } catch (err) {
    // localStorage might be disabled (private mode, quota, etc.) — never throw
    // eslint-disable-next-line no-console
    console.warn('[storageKeys] migrateLegacyKeys failed:', err);
    return false;
  }
}
