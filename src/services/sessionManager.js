/**
 * URL-handoff session manager.
 *
 * The desktop app rarely uses URL handoff — most sessions come from the
 * LoginDialog. But the embedded web SPA (Phase 4 of the migration plan)
 * passes a fresh JWT via `?jwt=...` on initial page load. This service:
 *
 *   1. Captures `?jwt=<token>` (or `?sid=<legacy>` — silently ignored)
 *   2. Stores the JWT under `osdb_com_jwt`
 *   3. Strips the parameter from the URL bar (history.replaceState)
 *
 * Public API is preserved (initializeSession, storeSessionId, getStoredSessionId,
 * clearStoredSession, isSessionValid, getSessionInfo) so existing call sites
 * (SubtitleUploader.jsx, AuthContext.jsx) keep working without changes.
 */

import { STORAGE_KEYS } from '../utils/storageKeys.js';
import { isValidSessionFormat } from '../utils/sessionUtils.js';

export class SessionManager {
  /**
   * Capture JWT from URL on app start (called once from SubtitleUploader.jsx).
   * Returns the captured JWT (or null).
   */
  static initializeSession() {
    if (typeof window === 'undefined') return null;

    let captured = null;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const jwt = urlParams.get('jwt');
      const legacySid = urlParams.get('sid');
      let mutated = false;

      if (jwt) {
        if (isValidSessionFormat(jwt)) {
          this.storeSessionId(jwt);
          captured = jwt;
          console.log(`🔐 SessionManager: ✅ Captured JWT from URL (${jwt.substring(0, 8)}...)`);
        } else {
          console.warn('🔐 SessionManager: URL ?jwt= is not a valid JWT shape; ignoring');
        }
        urlParams.delete('jwt');
        mutated = true;
      }

      if (legacySid) {
        // Legacy .org session id — won't authenticate against .com. Strip
        // from URL silently so it doesn't sit in browser history.
        urlParams.delete('sid');
        mutated = true;
      }

      if (mutated) {
        const cleanQs = urlParams.toString();
        const cleanUrl = window.location.pathname + (cleanQs ? `?${cleanQs}` : '');
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } catch (err) {
      console.error('🔐 SessionManager: initializeSession failed:', err);
    }

    return captured;
  }

  /** Store JWT in localStorage. */
  static storeSessionId(jwt) {
    try {
      localStorage.setItem(STORAGE_KEYS.JWT, jwt);
    } catch (err) {
      console.error('🔐 SessionManager: storeSessionId failed:', err);
    }
  }

  static getStoredSessionId() {
    try {
      return localStorage.getItem(STORAGE_KEYS.JWT) || null;
    } catch (err) {
      console.error('🔐 SessionManager: getStoredSessionId failed:', err);
      return null;
    }
  }

  static clearStoredSession() {
    try {
      localStorage.removeItem(STORAGE_KEYS.JWT);
    } catch (err) {
      console.error('🔐 SessionManager: clearStoredSession failed:', err);
    }
  }

  static isSessionValid() {
    return Boolean(this.getStoredSessionId());
  }

  static getSessionInfo() {
    const jwt = this.getStoredSessionId();
    return {
      hasSessionId: !!jwt,
      sessionId: jwt ? `${jwt.substring(0, 8)}...` : null,
      isValid: this.isSessionValid(),
    };
  }
}
