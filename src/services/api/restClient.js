/**
 * Unified REST client for api.opensubtitles.com/api/v1.
 *
 * Consolidates `xmlrpc.js` (legacy XML-RPC) and the partial `openSubtitlesApi.js`
 * into a single, well-factored client. Every outbound API call flows through here.
 *
 * Design notes:
 * - `Api-Key` header is always sent (Consumer auth via Kong)
 * - `Authorization: Bearer <jwt>` is sent when `authenticated !== false` AND a
 *   JWT is present in `authStore`. Anonymous calls use `{ authenticated: false }`.
 * - Server returns errors as `{ error_code, message, details? }` + an HTTP status.
 *   `RestError` preserves all three; `AuthError` is a specialization for 401s
 *   that also triggers `authStore.onAuthExpired()`.
 * - Network-level failures (no response, timeout, offline) are synthesized into
 *   `RestError`s with client-side codes (`network_error`, `timeout`, `offline`).
 * - Retry policy: retry on network errors and 5xx; NEVER retry on 4xx (including
 *   401 — user must act).
 *
 * See docs/plans/04-rest-client-refactor.md and 07-error-mapping.md.
 */

import {
  API_ENDPOINTS,
  OPENSUBTITLES_COM_API_KEY,
  getApiHeaders,
} from '../../utils/constants.js';
import { delayedFetch } from '../../utils/networkUtils.js';
import authStore from './authStore.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Structured REST error. Thrown for all 4xx / 5xx responses, plus client-side
 * synthesized network errors. `code` is the server's `error_code` field when
 * present, or a client-side code (`network_error`, `timeout`, `offline`,
 * `server_error`, `http_<status>`).
 */
export class RestError extends Error {
  constructor(code, message, status, details = {}) {
    super(message);
    this.name = 'RestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** 401 Unauthorized. Subclass so callers can catch auth failures specifically. */
export class AuthError extends RestError {
  constructor(message = 'Authentication required', details = {}) {
    super('unauthorized', message, 401, details);
    this.name = 'AuthError';
  }
}

// ---------------------------------------------------------------------------
// Client-side network error synthesis
// ---------------------------------------------------------------------------

function synthesizeNetworkError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new RestError('offline', 'You appear to be offline', 0, { original: err });
  }
  if (err && err.name === 'AbortError') {
    return new RestError('timeout', 'Request timed out', 0, { original: err });
  }
  if (err && err.name === 'TypeError' && /fetch/i.test(err.message || '')) {
    return new RestError('network_error', 'Could not reach the server', 0, { original: err });
  }
  return new RestError('unknown', err?.message ?? 'Unknown network error', 0, { original: err });
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const NON_RETRIABLE_CLIENT_CODES = new Set([
  'unauthorized',
  'offline',
]);

const DEFAULT_RETRIES = 1; // one retry on top of the first attempt (= 2 tries)

export class RestClient {
  constructor({ baseUrl, apiKey, fetchFn } = {}) {
    this.baseUrl = (baseUrl ?? API_ENDPOINTS.OPENSUBTITLES_REST).replace(/\/+$/, '');
    this.apiKey = apiKey ?? OPENSUBTITLES_COM_API_KEY;
    // Injectable for tests. In production we use `delayedFetch` so the global
    // 100ms rate-limit guard applies.
    this._fetch = fetchFn ?? delayedFetch;
  }

  /**
   * Build the outbound headers for a request.
   * - Always sends `Api-Key`, `User-Agent`, `X-User-Agent` (via getApiHeaders)
   * - Adds `Authorization: Bearer <jwt>` iff authenticated !== false AND token present
   * - Omits `Content-Type` for FormData (browser sets multipart boundary)
   */
  /**
   * Header builder.
   *
   * `contentType` semantics:
   *   - undefined → defaults to 'application/json'
   *   - 'application/json' (or any string) → set it
   *   - null → DO NOT set Content-Type at all (used for FormData so the browser
   *     can set the multipart boundary itself)
   */
  buildHeaders({ authenticated = 'auto', contentType, extra = {} } = {}) {
    const ct = contentType === undefined ? 'application/json' : contentType;
    // getApiHeaders requires a string; use a placeholder, then strip if needed
    const base = getApiHeaders(ct ?? 'application/json', { 'Api-Key': this.apiKey, ...extra });
    if (ct === null) delete base['Content-Type'];

    if (authenticated !== false) {
      const jwt = authStore.getToken();
      if (jwt) base.Authorization = `Bearer ${jwt}`;
    }
    return base;
  }

  /**
   * Build a full URL with optional query params. null/undefined query values are
   * omitted; numbers + booleans are coerced via URLSearchParams.
   */
  buildUrl(path, query) {
    const joined = path.startsWith('http')
      ? path
      : this.baseUrl + (path.startsWith('/') ? path : '/' + path);
    if (!query) return joined;

    // Build the query string directly rather than via `new URL()`, which
    // throws on a relative base (e.g. "/api/v1" when the dev server proxies
    // to a backend that sends no CORS headers).
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    if (!qs) return joined;
    return joined + (joined.includes("?") ? "&" : "?") + qs;
  }

  /**
   * Core request dispatcher. All verb helpers funnel here.
   *
   * @param {string} method   HTTP method
   * @param {string} path     Path starting with `/` (or a full URL)
   * @param {Object} [opts]
   * @param {Object|FormData} [opts.body]
   * @param {Object} [opts.query]
   * @param {'auto'|false} [opts.authenticated='auto']
   * @param {number} [opts.retries=1]      retries in addition to the first try
   * @param {AbortSignal} [opts.signal]
   */
  async request(method, path, opts = {}) {
    const { body, query, authenticated = 'auto', retries = DEFAULT_RETRIES, signal } = opts;

    const url = this.buildUrl(path, query);
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers = this.buildHeaders({
      authenticated,
      // null = don't set Content-Type (FormData), string = use it
      contentType: isFormData ? null : 'application/json',
    });

    const init = {
      method,
      headers,
      signal,
    };
    if (body !== undefined && body !== null) {
      init.body = isFormData ? body : JSON.stringify(body);
    }

    let lastError;
    const maxAttempts = 1 + Math.max(0, retries);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this._attempt(url, init, authenticated);
      } catch (err) {
        lastError = err;

        // Never retry auth errors — user must act
        if (err instanceof AuthError) throw err;

        // Don't retry non-retriable client errors
        if (err instanceof RestError && NON_RETRIABLE_CLIENT_CODES.has(err.code)) throw err;

        // Don't retry 4xx — user or payload issue, re-trying won't help
        if (err instanceof RestError && err.status >= 400 && err.status < 500) throw err;

        // Retry 5xx + network-level failures up to maxAttempts
        if (attempt >= maxAttempts) throw err;

        // Exponential backoff — 300ms, 600ms, 1200ms...
        const backoff = 300 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    // unreachable — loop either returns or throws
    throw lastError;
  }

  async _attempt(url, init, authenticated) {
    let response;
    try {
      response = await this._fetch(url, init);
    } catch (err) {
      // fetch rejected before we got a response — network-layer failure
      throw synthesizeNetworkError(err);
    }

    // 401 — surface as AuthError and fire the expiry handler (authenticated calls only)
    if (response.status === 401) {
      if (authenticated !== false) {
        authStore.onAuthExpired();
      }
      const data = await this._safeJson(response);
      throw new AuthError(data?.message ?? 'Authentication required', data?.details ?? {});
    }

    if (response.status === 429) {
      const data = await this._safeJson(response);
      throw new RestError(
        data?.error_code ?? 'quota_exceeded',
        data?.message ?? 'Rate limited',
        429,
        data?.details ?? {}
      );
    }

    if (!response.ok) {
      const data = await this._safeJson(response);
      const code =
        data?.error_code ??
        (response.status >= 500 ? 'server_error' : `http_${response.status}`);
      throw new RestError(
        code,
        data?.message ?? response.statusText,
        response.status,
        data?.details ?? {}
      );
    }

    return this._safeJson(response);
  }

  async _safeJson(response) {
    try {
      // 204 No Content or empty body
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  // ---- verb helpers -------------------------------------------------------

  get(path, opts = {}) {
    return this.request('GET', path, opts);
  }

  post(path, body, opts = {}) {
    return this.request('POST', path, { ...opts, body });
  }

  patch(path, body, opts = {}) {
    return this.request('PATCH', path, { ...opts, body });
  }

  put(path, body, opts = {}) {
    return this.request('PUT', path, { ...opts, body });
  }

  delete(path, opts = {}) {
    return this.request('DELETE', path, opts);
  }
}

/** Default singleton — most callers use this. */
export const restClient = new RestClient();

// Expose internal synth for tests
export const __test__ = { synthesizeNetworkError };
