/**
 * Authentication service — JWT Bearer against opensubtitles.com.
 *
 * Replaces the legacy XML-RPC LogIn/LogOut/GetUserInfo flow. State machine
 * documented in docs/plans/03-auth-migration.md §3.
 *
 * Public API (preserved for AuthContext + components):
 *   await authService.login(username, password, lang)
 *     → { success, token?, userData?, error?, message }
 *   await authService.logout() → { success, message }
 *   await authService.checkAuthStatus(jwt?) → userData|null
 *   authService.isLoggedIn() → boolean
 *   authService.getToken() → string|null
 *   authService.getUserData() → object|null
 *   authService.isAnonymous() → boolean
 *   authService.getUserPreferredLanguages() → string[]
 *   await authService.restoreAuthFromStorage() → boolean
 *   await authService.clearAuthData() → void
 *
 * Wires `authStore.setToken()` on every state change so the unified REST
 * client can attach `Authorization: Bearer <jwt>` headers automatically.
 */

import { authApi } from './api/auth.js';
import authStore from './api/authStore.js';
import { adaptRestUser, mergeRefreshedUser } from './api/userData.js';
import { STORAGE_KEYS } from '../utils/storageKeys.js';
import { logSensitiveData } from '../utils/securityUtils.js';
import { APP_VERSION } from '../utils/constants.js';

const MAX_HYDRATE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — JWT itself expires server-side at 24h

class AuthService {
  constructor() {
    this.token = null;
    this.userData = null;
    this.isAuthenticated = false;
    this.userAgent = `OpenSubtitles Uploader v${APP_VERSION}`;

    // Wire authStore so restClient picks up auth state changes
    authStore.registerOnExpired(() => this._handleAuthExpired());
  }

  // ---------------------------------------------------------------------
  // Login / logout
  // ---------------------------------------------------------------------

  /**
   * Log in with plaintext credentials. The .com REST `/login` endpoint
   * validates against Devise bcrypt internally — NO client-side MD5.
   *
   * @param {string} username
   * @param {string} password   plaintext, sent over HTTPS
   * @param {string} [_lang]    accepted for back-compat with old signature; not sent server-side
   * @returns {Promise<{success: boolean, token?: string, userData?: object, error?: string, message: string, isAnonymous?: boolean}>}
   */
  async login(username, password, _lang = 'en') {
    try {
      const response = await authApi.login({ username, password });

      if (!response || response.status !== 200 || !response.token) {
        const message = response?.message || 'Login failed';
        await this.clearAuthData();
        return { success: false, error: message, message: `Login failed: ${message}` };
      }

      this.token = response.token;
      this.userData = adaptRestUser(response.user, {
        username,
        baseUrl: response.base_url,
      });
      this.isAuthenticated = true;
      authStore.setToken(this.token);

      logSensitiveData('🔐 JWT received', this.token, 'token');

      // Persist
      this._writeStorage(this.token, this.userData);

      // Best-effort enhancement via /infos/user (gives quota fields some servers
      // omit from /login; if it fails, we proceed with login data only)
      try {
        const enhanced = await authApi.getUserInfo();
        if (enhanced) {
          this.userData = mergeRefreshedUser(this.userData, enhanced);
          this._writeStorage(this.token, this.userData);
        }
      } catch (err) {
        // Non-fatal — we already have the login response
        // eslint-disable-next-line no-console
        console.warn('[authService] /infos/user enhancement failed (non-fatal):', err?.message);
      }

      return {
        success: true,
        token: this.token,
        userData: this.userData,
        isAnonymous: false,
        message: `Login successful as ${this.userData?.username || 'User'}`,
      };
    } catch (err) {
      // Surface server-friendly message when available (e.g. lockout text)
      const serverMessage =
        err?.details?.message ||
        err?.message ||
        'Network error';
      await this.clearAuthData();
      return {
        success: false,
        error: serverMessage,
        message: `Login failed: ${serverMessage}`,
      };
    }
  }

  /**
   * Log out. Calls the server best-effort, then clears local state regardless.
   */
  async logout() {
    try {
      if (this.token) {
        await authApi.logout();
      }
    } catch (err) {
      // Already best-effort inside authApi.logout — defensive double-catch
      // eslint-disable-next-line no-console
      console.warn('[authService] logout API call failed:', err?.message);
    } finally {
      await this.clearAuthData();
    }
    return { success: true, message: 'Logout successful' };
  }

  // ---------------------------------------------------------------------
  // Session validation
  // ---------------------------------------------------------------------

  /**
   * Verify the current token is still valid by fetching /infos/user.
   * If `tokenOverride` is supplied, temporarily uses that token (for the
   * URL-handoff scenario).
   *
   * Returns the user data on success (and updates state); null on failure.
   */
  async checkAuthStatus(tokenOverride = null) {
    const tokenToUse = tokenOverride || this.token;
    if (!tokenToUse) return null;

    const previousToken = this.token;
    this.token = tokenToUse;
    authStore.setToken(this.token);

    try {
      const restUser = await authApi.getUserInfo();
      if (!restUser) {
        // /infos/user returned empty body — treat as expired
        await this.clearAuthData();
        return null;
      }

      this.userData = mergeRefreshedUser(this.userData, restUser);
      this.isAuthenticated = true;
      this._writeStorage(this.token, this.userData);
      return this.userData;
    } catch (err) {
      // 401 (AuthError) → clear; other errors → treat as transient, keep stored data
      if (err?.status === 401) {
        await this.clearAuthData();
        return null;
      }
      // Roll back the token optimistic write
      this.token = previousToken;
      authStore.setToken(this.token);
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // State accessors (for components / hooks)
  // ---------------------------------------------------------------------

  isLoggedIn() {
    return this.isAuthenticated && !!this.token;
  }

  getToken() {
    return this.token;
  }

  getUserData() {
    return this.userData;
  }

  isAnonymous() {
    return !this.isAuthenticated || !this.userData?.username;
  }

  getUserPreferredLanguages() {
    // .com doesn't expose this; default to English
    return ['en'];
  }

  /**
   * Headers helper kept for any caller still using it (legacy compat).
   * The unified REST client uses `getApiHeaders()` from constants.js +
   * authStore.getToken() so this is rarely needed.
   */
  getAuthHeaders() {
    return {
      'User-Agent': this.userAgent,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  /**
   * Restore auth state from localStorage on app start. Does NOT validate
   * with the server — caller (AuthContext) does that next via checkAuthStatus.
   *
   * @returns {Promise<boolean>} true iff state was hydrated
   */
  async restoreAuthFromStorage() {
    try {
      const token = this._safeGet(STORAGE_KEYS.JWT);
      const userJson = this._safeGet(STORAGE_KEYS.USER);
      const loginTimeStr = this._safeGet(STORAGE_KEYS.LOGIN_TIME);

      if (!token || !userJson || !loginTimeStr) return false;

      const ageMs = Date.now() - parseInt(loginTimeStr, 10);
      if (Number.isNaN(ageMs) || ageMs < 0 || ageMs > MAX_HYDRATE_AGE_MS) {
        // Sanity guard — hugely stale or clock-skewed; throw away and re-login
        await this.clearAuthData();
        return false;
      }

      this.token = token;
      this.userData = JSON.parse(userJson);
      this.isAuthenticated = true;
      authStore.setToken(this.token);
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[authService] restoreAuthFromStorage failed:', err?.message);
      await this.clearAuthData();
      return false;
    }
  }

  /**
   * Wipe in-memory state, localStorage keys, and any user-info cache.
   */
  async clearAuthData() {
    this.token = null;
    this.userData = null;
    this.isAuthenticated = false;
    authStore.setToken(null);

    this._safeRemove(STORAGE_KEYS.JWT);
    this._safeRemove(STORAGE_KEYS.USER);
    this._safeRemove(STORAGE_KEYS.LOGIN_TIME);

    // Defer-import UserService to break the circular dep
    try {
      const { UserService } = await import('./userService.js');
      UserService.clearUserInfoCache();
    } catch (err) {
      // First-load timing — fine to ignore
    }
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  _writeStorage(token, userData) {
    this._safeSet(STORAGE_KEYS.JWT, token);
    this._safeSet(STORAGE_KEYS.USER, JSON.stringify(userData));
    this._safeSet(STORAGE_KEYS.LOGIN_TIME, Date.now().toString());
  }

  _safeGet(key) {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }

  _safeSet(key, value) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch {
      /* quota / private mode — ignore */
    }
  }

  _safeRemove(key) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  /**
   * Called by authStore.onAuthExpired() (which restClient triggers on 401).
   * Clears state + dispatches a window event for the UI to react to.
   */
  async _handleAuthExpired() {
    await this.clearAuthData();
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('osdb:auth-expired'));
      } catch {
        /* ignore in non-browser envs */
      }
    }
  }
}

const authService = new AuthService();

// Auto-restore on module load
authService.restoreAuthFromStorage().catch((err) => {
  // eslint-disable-next-line no-console
  console.warn('[authService] restore-on-load failed:', err?.message);
});

export default authService;
