import React, { createContext, useContext, useEffect, useState } from 'react';
import authService from '../services/authService.js';
import { SessionManager } from '../services/sessionManager.js';
import { detectSession, logSessionDetection, SessionSource } from '../utils/sessionUtils.js';

/**
 * Authentication context — JWT Bearer against opensubtitles.com.
 *
 * State machine:
 *   APP START
 *     1. authService auto-restores from localStorage on module load
 *     2. AuthContext.initAuth() runs:
 *        - if URL has ?jwt=, prefer it (calls authService.checkAuthStatus(jwt))
 *        - else if JWT was hydrated, validate via GET /infos/user
 *        - else stay logged out
 *     3. On 401 mid-session, restClient → authStore.onAuthExpired() →
 *        authService dispatches `osdb:auth-expired` window event, which
 *        this context listens for and reflects into state.
 *
 * Public context value (preserved for back-compat):
 *   { isAuthenticated, user, token, loading, error,
 *     login, logout, isAnonymous, getUserPreferredLanguages,
 *     clearError, refreshAuth, authService }
 */

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // -------------------------------------------------------------------
  // Initial auth resolution
  // -------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      try {
        const sessionDetection = logSessionDetection('AuthContext Initialization');
        const sessionId = sessionDetection.sessionId;

        if (sessionId) {
          // Validate the JWT (URL or stored) by calling GET /infos/user
          const userInfo = await authService.checkAuthStatus(sessionId);
          if (cancelled) return;

          if (userInfo) {
            setIsAuthenticated(true);
            setUser(userInfo);
            setToken(authService.getToken());

            // If the JWT came in via URL handoff, persist it
            if (sessionDetection.source === SessionSource.URL_JWT_PARAMETER) {
              SessionManager.storeSessionId(sessionId);
            }
          } else {
            // Invalid/expired JWT
            setIsAuthenticated(false);
            setUser(null);
            setToken(null);
            SessionManager.clearStoredSession();
          }
        } else {
          // No session anywhere → stay logged out
          setIsAuthenticated(false);
          setUser(null);
          setToken(null);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('❌ Auth initialization error:', err);
        setError(`Auth initialization failed: ${err.message}`);
        setIsAuthenticated(false);
        setUser(null);
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    initAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------
  // 401 listener — mid-session expiry
  // -------------------------------------------------------------------

  useEffect(() => {
    const handler = () => {
      setIsAuthenticated(false);
      setUser(null);
      setToken(null);
      setError('Your session has expired. Please log in again.');
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('osdb:auth-expired', handler);
      return () => window.removeEventListener('osdb:auth-expired', handler);
    }
    return undefined;
  }, []);

  // -------------------------------------------------------------------
  // login / logout
  // -------------------------------------------------------------------

  const login = async (username, password, language = 'en') => {
    try {
      setLoading(true);
      setError(null);

      // PLAINTEXT — no MD5. .com /login validates via Devise bcrypt.
      const result = await authService.login(username, password, language);

      if (result.success) {
        setIsAuthenticated(true);
        setUser(result.userData);
        setToken(result.token);

        if (result.userData?.username) {
          try {
            localStorage.setItem('opensubtitles_remembered_username', result.userData.username);
          } catch {
            /* ignore */
          }
        }
      } else {
        setError(result.message || 'Login failed');
      }
      return result;
    } catch (err) {
      const errorMessage = err.message || 'Login failed';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await authService.logout();
      setIsAuthenticated(false);
      setUser(null);
      setToken(null);
      return result;
    } catch (err) {
      const errorMessage = err.message || 'Logout failed';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  const isAnonymous = () => authService.isAnonymous();
  const getUserPreferredLanguages = () => authService.getUserPreferredLanguages();
  const clearError = () => setError(null);

  /**
   * `refreshAuth` — kept for back-compat with the legacy API. Without a
   * refresh-token mechanism (.com doesn't issue them), the only honest
   * answer to "refresh" is "please log in again". We surface the error
   * so the LoginDialog can be shown.
   */
  const refreshAuth = async () => {
    setError('Please login again to refresh your session');
    return { success: false, error: 'Session expired' };
  };

  const value = {
    // State
    isAuthenticated,
    user,
    token,
    loading,
    error,

    // Methods
    login,
    logout,
    isAnonymous,
    getUserPreferredLanguages,
    clearError,
    refreshAuth,

    // Utility — direct service for components that need lower-level access
    authService,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
