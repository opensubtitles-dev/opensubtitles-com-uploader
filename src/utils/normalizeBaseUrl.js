export const DEFAULT_BASE_URL = 'https://api.opensubtitles.com/api/v1';

/**
 * Pure URL normalizer for the API base. Lives in its own module so that
 * both constants.js and config/environments.js can use it without an
 * import cycle (constants.js imports environments.js).
 *
 *   normalizeBaseUrl(undefined)                        → DEFAULT_BASE_URL
 *   normalizeBaseUrl('')                               → DEFAULT_BASE_URL
 *   normalizeBaseUrl('http://localhost:3001')          → 'http://localhost:3001/api/v1'
 *   normalizeBaseUrl('http://localhost:3001/api/v1/')  → 'http://localhost:3001/api/v1'
 *   normalizeBaseUrl('https://x.com/api/v2')           → 'https://x.com/api/v2'
 */
export function normalizeBaseUrl(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'string') return DEFAULT_BASE_URL;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_BASE_URL;
  if (!/\/api\/v\d+$/.test(trimmed)) return trimmed + '/api/v1';
  return trimmed;
}
