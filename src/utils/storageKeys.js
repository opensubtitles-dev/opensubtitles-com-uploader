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

// Auth state
export const STORAGE_KEYS = Object.freeze({
  JWT:        'osdb_com_jwt',
  USER:       'osdb_com_user',
  LOGIN_TIME: 'osdb_com_login_time',
  // Pre-existing — kept unchanged (purely cosmetic "remember last username")
  REMEMBERED_USERNAME: 'opensubtitles_remembered_username',
  // Migration marker — presence means we already pruned legacy keys
  MIGRATION_V2_DONE: 'osdb_migration_v2_done',
  // User preference — backend endpoint selection (for dual-endpoint toggle)
  BACKEND_PREF: 'osdb_backend',  // values: 'com' (default) | 'org'
});

// Cache key prefixes — used with suffixes per-entry
export const CACHE_PREFIXES = Object.freeze({
  LANGUAGES:          'rest_languages_cache',
  FEATURES_IMDB:      'rest_features_cache:imdb:',
  FEATURES_QUERY:     'rest_features_cache:query:',
  MOVIE_GUESS:        'rest_movie_guess_cache:',
  CHECK:              'rest_check_cache:',
  LANG_DETECT:        'rest_lang_detect_cache:',
  GUESSIT:            'rest_guessit_cache:',
});

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
