/**
 * Tiny, framework-free store for the JWT + an "auth expired" callback.
 *
 * Exists to break the circular dependency between:
 *   - restClient.js (needs to read the JWT for every authenticated request)
 *   - authService.js (wraps restClient.login() and manages auth state)
 *
 * authService holds the source of truth; authStore is the read-side lens
 * that restClient reaches for when building request headers, plus a hook
 * that restClient calls when the server returns 401.
 *
 * See docs/plans/04-rest-client-refactor.md §2.1.
 */

let _token = null;
let _onExpired = () => {
  // default no-op; authService registers the real handler at init time
};

const authStore = {
  /** Current JWT Bearer, or null. */
  getToken() {
    return _token;
  },

  /** Called by authService on login / hydrate / logout. */
  setToken(token) {
    _token = token || null;
  },

  /** Invoked by restClient when a 401 comes back from an authenticated call. */
  onAuthExpired() {
    try {
      _onExpired();
    } catch (err) {
      // Never let the expiry handler crash the request pipeline
      // eslint-disable-next-line no-console
      console.error('[authStore] onAuthExpired handler threw:', err);
    }
  },

  /** authService calls this once at startup to wire the handler. */
  registerOnExpired(handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('authStore.registerOnExpired expects a function');
    }
    _onExpired = handler;
  },

  /** Test helper — reset to a clean state. */
  _reset() {
    _token = null;
    _onExpired = () => {};
  },
};

export default authStore;
