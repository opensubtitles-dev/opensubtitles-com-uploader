/**
 * User session service — REST GET /infos/user with 1-hour caching.
 *
 * Replaces the legacy XML-RPC GetUserInfo flow. Field accessors operate on
 * the adapted user object produced by `services/api/userData.js`, which
 * exposes BOTH the new fields (`username`, `level`, ...) AND the legacy
 * XML-RPC names (`UserNickName`, `UserRank`, `IDUser`) for back-compat with
 * existing components.
 */

import { authApi } from './api/auth.js';
import { adaptRestUser, mergeRefreshedUser } from './api/userData.js';
import authService from './authService.js';
import { logSensitiveData } from '../utils/securityUtils.js';

export class UserService {
  // ---------------------------------------------------------------------
  // Cache (1-hour TTL, in-memory, per-token key)
  // ---------------------------------------------------------------------

  static _userInfoCache = new Map();
  static _cacheExpiry = 60 * 60 * 1000; // 1 hour

  static _cleanExpiredCache() {
    const now = Date.now();
    for (const [key, entry] of this._userInfoCache) {
      if (now > entry.expiresAt) this._userInfoCache.delete(key);
    }
  }

  /** Wipe the cache. Called by authService.clearAuthData() on logout. */
  static clearUserInfoCache() {
    this._userInfoCache.clear();
  }

  // ---------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------

  /**
   * Fetch user info via GET /infos/user, cached 1 hour by current JWT.
   *
   * @param {string|null} [_sessionId]  unused; kept for back-compat with the legacy signature
   * @param {Function|null} [addDebugInfo] optional debug callback
   * @param {boolean} [bypassCache] force a fresh fetch
   * @returns {Promise<object|null>} adapted user object, or null if not authenticated
   */
  static async getUserInfo(_sessionId = null, addDebugInfo = null, bypassCache = false) {
    this._cleanExpiredCache();

    const token = authService.getToken() || '';
    if (!token) {
      addDebugInfo && addDebugInfo('👤 No JWT — anonymous; skipping /infos/user');
      return null;
    }

    if (!bypassCache && this._userInfoCache.has(token)) {
      const cached = this._userInfoCache.get(token);
      if (Date.now() < cached.expiresAt) {
        addDebugInfo &&
          addDebugInfo(
            `📄 Cached /infos/user (${Math.round((cached.expiresAt - Date.now()) / 60000)}min remaining)`
          );
        return cached.data;
      }
      this._userInfoCache.delete(token);
    }

    try {
      addDebugInfo && addDebugInfo('👤 Fetching fresh /infos/user');
      logSensitiveData('👤 GET /infos/user with JWT', token, 'token');

      const restUser = await authApi.getUserInfo();
      if (!restUser) {
        addDebugInfo && addDebugInfo('👤 Empty /infos/user response');
        return null;
      }

      // Merge into authService's existing userData (preserves username from login)
      const existing = authService.getUserData();
      const merged = mergeRefreshedUser(existing, restUser);

      this._userInfoCache.set(token, {
        data: merged,
        cachedAt: Date.now(),
        expiresAt: Date.now() + this._cacheExpiry,
      });

      addDebugInfo &&
        addDebugInfo(`✅ /infos/user fetched and cached: ${merged?.username || 'User'}`);
      return merged;
    } catch (err) {
      // 401 means token expired — restClient already cleared auth via authStore
      if (err?.status === 401) {
        addDebugInfo && addDebugInfo('👤 Session expired (401)');
        return null;
      }
      addDebugInfo && addDebugInfo(`❌ /infos/user failed: ${err?.message}`);
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Field accessors — work against the adapted shape
  // ---------------------------------------------------------------------

  static getUsername(userInfo) {
    return userInfo?.username || userInfo?.UserNickName || 'Anonymous';
  }

  static isLoggedIn(userInfo) {
    return Boolean(userInfo?.username || userInfo?.UserNickName);
  }

  static getPreferredLanguages(userInfo) {
    return userInfo?.UserPreferedLanguages || '';
  }

  static getUserRank(userInfo) {
    return userInfo?.level || userInfo?.UserRank || '';
  }

  static getUserRanks(userInfo) {
    if (Array.isArray(userInfo?.UserRanks) && userInfo.UserRanks.length > 0) {
      return userInfo.UserRanks;
    }
    const single = this.getUserRank(userInfo);
    return single ? [single] : [];
  }

  static getUploadCount(userInfo) {
    return parseInt(userInfo?.UploadCnt) || 0;
  }

  static getDownloadCount(userInfo) {
    return parseInt(userInfo?.DownloadCnt) || 0;
  }

  // ---------------------------------------------------------------------
  // Permission checks
  // ---------------------------------------------------------------------

  /**
   * Validate that the user's level is allowed to upload. The .com server's
   * anti-abuse pipeline is the source of truth — this client-side check is
   * an early UX hint only. We err on the side of allowing; the server
   * rejects with `error_code: "banned"` etc. when needed.
   */
  static validateUserRank(userInfo) {
    const ranks = this.getUserRanks(userInfo);
    const current = this.getUserRank(userInfo);
    const effective = ranks.length > 0 ? ranks : current ? [current] : [];

    // Forbidden — explicit deny
    const forbiddenSubstrings = ['read only'];
    const forbidden = effective.find(rank =>
      forbiddenSubstrings.some(f => rank.toLowerCase().includes(f.toLowerCase()))
    );
    if (forbidden) {
      return {
        allowed: false,
        reason: `Access denied: Your account has "${forbidden}" restriction which prevents uploading.`,
        userRanks: effective,
        forbiddenRank: forbidden,
      };
    }

    // Allowed list — covers .com level names + legacy .org rank names
    const allowedExact = new Set(
      [
        // .com levels (Standard → admin)
        'sub leecher',
        'bronze member',
        'silver member',
        'gold member',
        'platinum member',
        'trusted member',
        'translator',
        'application developers',
        'vip member',
        'vip+ member',
        'vip++ member',
        'vip lifetime',
        'opensubtitles legends',
        'administrator',
        'superadministrator',
        // legacy .org names (kept for compatibility with cached data)
        'super admin',
        'moderator',
        'trusted',
        'subtranslator',
        'os legend',
      ].map(s => s.toLowerCase().trim())
    );

    const matched = effective.find(rank => allowedExact.has(rank.toLowerCase().trim()));
    if (matched) {
      return {
        allowed: true,
        reason: `Access granted with level: ${matched}`,
        userRanks: effective,
        allowedRank: matched,
      };
    }

    // VIP fast-path — if the .com user object had vip: true it would have
    // been mapped to a level above. This catches odd cases where vip is set
    // on the new user object directly.
    if (userInfo?.vip === true) {
      return {
        allowed: true,
        reason: 'Access granted (VIP)',
        userRanks: effective,
        allowedRank: 'vip',
      };
    }

    return {
      allowed: false,
      reason: `Account level "${current || 'unknown'}" is not in the upload-allowed list.`,
      userRanks: effective,
      currentRank: current,
    };
  }

  static canUserUpload(userInfo) {
    if (!this.isLoggedIn(userInfo)) {
      return {
        canUpload: false,
        reason: 'Please log in to upload subtitles.',
        rankValidation: null,
      };
    }
    const rankValidation = this.validateUserRank(userInfo);
    return {
      canUpload: rankValidation.allowed,
      reason: rankValidation.reason,
      rankValidation,
    };
  }
}
