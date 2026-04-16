/**
 * Languages API — REST replacement for the legacy XML-RPC `GetSubLanguages` call.
 *
 * Endpoint: GET /api/v1/infos/languages
 *
 * The server-side endpoint already filters to upload-enabled languages
 * (`OsdbLanguage.where(upload_enabled: true)`) and returns a minimal
 * `{ data: [{ language_code, language_name }] }` envelope.
 *
 * This is one of TWO language sources used in the app:
 *   - this one (upload-enabled list — what the user can pick when uploading)
 *   - `OpenSubtitlesApiService.getSupportedLanguages()` (FastText-supported list
 *     for language detection — separate concern, untouched by this migration)
 *
 * See docs/plans/02-endpoint-mapping.md §E4
 *     docs/plans/04-rest-client-refactor.md §7
 */

import { restClient as defaultClient } from './restClient.js';
import { CACHE_PREFIXES } from '../../utils/storageKeys.js';

const CACHE_KEY = CACHE_PREFIXES.LANGUAGES;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Pure normalizer — extracted so tests can hit it without loading any of the
 * cache/network plumbing. Lowercases codes, dedupes, drops blanks.
 *
 * @param {unknown} response  raw `restClient.get('/infos/languages')` body
 * @returns {Array<{language_code: string, language_name: string}>}
 */
export function normalizeLanguagesResponse(response) {
  const list = Array.isArray(response?.data) ? response.data : [];
  const out = [];
  const seen = new Set();
  for (const lang of list) {
    const code = String(lang?.language_code ?? '').toLowerCase();
    const name = lang?.language_name ?? '';
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ language_code: code, language_name: name });
  }
  return out;
}

/**
 * Factory — injectable for tests. The default export wires the real client +
 * the real CacheService.
 *
 * @param {object} deps
 * @param {object} deps.client      restClient-shaped object with .get(path, opts)
 * @param {object} [deps.cache]     CacheService-shaped object; if omitted, no caching
 */
export function createLanguagesApi({ client, cache }) {
  return {
    /**
     * Fetch the list of upload-enabled languages.
     * @returns {Promise<{ data: Array<{language_code, language_name}>, fromCache: boolean }>}
     */
    async list() {
      if (cache) {
        const cached = cache.loadFromCache(CACHE_KEY);
        if (cached) return { data: cached, fromCache: true };
      }

      // No JWT required for /infos/languages — explicitly anonymous
      const response = await client.get('/infos/languages', { authenticated: false });
      const data = normalizeLanguagesResponse(response);

      if (cache) {
        cache.saveToCache(CACHE_KEY, data, `max-age=${CACHE_TTL_MS / 1000}`);
      }
      return { data, fromCache: false };
    },

    /** Test helper — clear the cache so the next call hits the network. */
    _clearCache() {
      if (cache) cache.clearCache(CACHE_KEY);
    },
  };
}

// Default singleton — most callers use this. Lazy-load CacheService so test
// callers can use createLanguagesApi() without pulling in pako via cache.js.
let _defaultApi = null;
async function _getDefaultApi() {
  if (_defaultApi) return _defaultApi;
  const { CacheService } = await import('../cache.js');
  _defaultApi = createLanguagesApi({ client: defaultClient, cache: CacheService });
  return _defaultApi;
}

export const languagesApi = {
  async list() {
    return (await _getDefaultApi()).list();
  },
  async _clearCache() {
    return (await _getDefaultApi())._clearCache();
  },
};
