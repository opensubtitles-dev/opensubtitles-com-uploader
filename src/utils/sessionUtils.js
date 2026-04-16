/**
 * JWT detection — successor to the legacy PHPSESSID/cookie session detector.
 *
 * Sources, in priority order:
 *   1. URL parameter `?jwt=` (highest — fresh handoff from a server-side
 *      flow such as the embedded web SPA)
 *   2. URL parameter `?sid=` (LEGACY — silently captured for the URL-cleanup
 *      side-effect, then ignored. The token itself wouldn't work against
 *      .com anyway.)
 *   3. localStorage `osdb_com_jwt` (previously stored by authService)
 *
 * Cookies (`PHPSESSID`, `remember_sid`) are no longer consulted — they were
 * .org-only and don't apply to the .com REST flow.
 */

import { logSensitiveData } from './securityUtils.js';
import { STORAGE_KEYS } from './storageKeys.js';

/** Legacy export kept so any importer that still references it doesn't break. */
export const getCookie = name => {
  try {
    if (typeof document === 'undefined') return null;
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      return parts.pop().split(';').shift() || null;
    }
    return null;
  } catch (err) {
    console.warn(`🍪 Failed to read cookie ${name}:`, err.message);
    return null;
  }
};

export const getStorageItem = key => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch (err) {
    console.warn(`💾 Failed to read localStorage ${key}:`, err.message);
    return null;
  }
};

export const getUrlParam = param => {
  try {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get(param);
  } catch (err) {
    console.warn(`🔗 Failed to read URL parameter ${param}:`, err.message);
    return null;
  }
};

/** Where a session was found. */
export const SessionSource = Object.freeze({
  URL_JWT_PARAMETER: 'url_jwt_parameter',
  STORED_JWT: 'stored_jwt',
  NONE: 'none',
});

/**
 * JWT format check. JWTs are base64url-encoded triples joined by dots
 * (header.payload.signature). We match on shape only — actual signature
 * verification happens server-side.
 */
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const isValidSessionFormat = token => {
  if (!token || typeof token !== 'string') return false;
  return JWT_PATTERN.test(token.trim());
};

/**
 * Detect the current session JWT.
 *
 * @returns {{ sessionId: string|null, source: string, debug: object }}
 */
export const detectSession = () => {
  const result = {
    sessionId: null,
    source: SessionSource.NONE,
    debug: {
      urlJwt: null,
      storedJwt: null,
      timestamp: new Date().toISOString(),
    },
  };

  // 1. URL ?jwt=
  const urlJwt = getUrlParam('jwt');
  result.debug.urlJwt = urlJwt ? `${urlJwt.substring(0, 8)}...` : null;
  if (urlJwt && isValidSessionFormat(urlJwt)) {
    result.sessionId = urlJwt;
    result.source = SessionSource.URL_JWT_PARAMETER;
    logSensitiveData('🔍 JWT detected from URL parameter', urlJwt, 'session');
    return result;
  }

  // 2. localStorage osdb_com_jwt
  const storedJwt = getStorageItem(STORAGE_KEYS.JWT);
  result.debug.storedJwt = storedJwt ? `${storedJwt.substring(0, 8)}...` : null;
  if (storedJwt) {
    result.sessionId = storedJwt;
    result.source = SessionSource.STORED_JWT;
    logSensitiveData('🔍 JWT detected from storage', storedJwt, 'session');
    return result;
  }

  return result;
};

export const getSessionDebugInfo = () => {
  const detection = detectSession();
  return {
    ...detection,
    localStorage: {
      jwt: getStorageItem(STORAGE_KEYS.JWT),
      user: getStorageItem(STORAGE_KEYS.USER),
      loginTime: getStorageItem(STORAGE_KEYS.LOGIN_TIME),
    },
    url: typeof window !== 'undefined' ? window.location.href : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    timestamp: new Date().toISOString(),
  };
};

export const logSessionDetection = (context = 'Unknown') => {
  const info = getSessionDebugInfo();
  if (info.sessionId) {
    logSensitiveData(`🔍 [${context}] JWT detected from ${info.source}`, info.sessionId, 'session');
  }
  return info;
};
