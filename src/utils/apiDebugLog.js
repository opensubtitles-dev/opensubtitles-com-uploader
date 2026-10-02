import { CACHE_KEYS } from './constants.js';

/**
 * HTTP request log for debug mode.
 *
 * WHY THIS EXISTS
 *
 * restClient logged nothing — not one console call in the whole HTTP layer. So
 * when a request failed, the only answer available was "403", with no way to
 * tell whether the key had even been sent. Diagnosing that meant walking a user
 * through DevTools, which is not something you can ask of a stranger who has
 * filed a support ticket.
 *
 * Every request passes through RestClient#_attempt, retries included, so one
 * wrap there captures the lot.
 *
 * MASKING
 *
 * The project rule is "never log tokens, session IDs, cookies or auth headers"
 * (root CLAUDE.md). This keeps the LAST FOUR characters and masks the rest —
 * the inverse of masking only the last four, which would leave 28 of a 32-char
 * key in plain sight in a file users are asked to email to support.
 *
 * Four characters answers every question worth asking of a log: is a key
 * present at all, and is it the SAME key as the one that works? It can never
 * reconstruct the secret.
 */

const MAX_ENTRIES = 300;
const entries = [];

// Header names whose values must never be written out in full.
const SENSITIVE_HEADERS = ['api-key', 'api_key', 'authorization', 'cookie', 'x-auth-token'];

/**
 * "absent" when missing; otherwise the last 4 characters behind bullets.
 * A value too short to mask safely is reported by length alone, never shown.
 */
export function maskSecret(value) {
  if (value === undefined || value === null || value === '') return 'absent';
  const s = String(value);
  if (s.length <= 4) return `present (${s.length} chars, too short to show)`;
  return `${'•'.repeat(8)}${s.slice(-4)} (${s.length} chars)`;
}

/** Mask every sensitive header, pass the rest through untouched. */
export function maskHeaders(headers = {}) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.includes(name.toLowerCase())) {
      // "Bearer eyJ..." — mask the credential but keep the scheme, which is the
      // part that actually matters when reading a log.
      const m = /^(\w+)\s+(.*)$/.exec(String(value));
      out[name] = m ? `${m[1]} ${maskSecret(m[2])}` : maskSecret(value);
    } else {
      out[name] = value;
    }
  }
  return out;
}

export function isApiDebugEnabled() {
  try {
    return localStorage.getItem(CACHE_KEYS.DEBUG_MODE) === 'true';
  } catch {
    // Private mode, blocked storage — logging must never break a request.
    return false;
  }
}

/**
 * Record one completed attempt. Silent unless debug mode is on, so this is safe
 * to call unconditionally from the request path.
 */
export function logApiCall(entry) {
  if (!isApiDebugEnabled()) return;

  const record = {
    t: new Date().toISOString(),
    method: entry.method,
    url: entry.url,
    status: entry.status ?? null,
    ms: entry.ms ?? null,
    headers: maskHeaders(entry.headers),
    attempt: entry.attempt ?? 1,
    error: entry.error ?? null,
  };

  entries.push(record);
  if (entries.length > MAX_ENTRIES) entries.shift();

  const label = record.status ? `${record.status}` : 'FAILED';
  console.debug(`[API] ${record.method} ${record.url} → ${label} (${record.ms ?? '?'}ms)`, {
    headers: record.headers,
    error: record.error,
  });
}

/** Newest last. Consumed by DebugPanel's copy/export. */
export function getApiLog() {
  return entries.slice();
}

/** Plain text, for the clipboard or a downloaded file. */
export function formatApiLog() {
  if (entries.length === 0) {
    return 'No API calls recorded. Enable debug mode, then reproduce the problem.';
  }
  return entries
    .map(e => {
      const head =
        `${e.t}  ${e.method} ${e.url}  → ${e.status ?? 'FAILED'} (${e.ms ?? '?'}ms)` +
        (e.attempt > 1 ? `  [attempt ${e.attempt}]` : '');
      const hdrs = Object.entries(e.headers)
        .map(([k, v]) => `    ${k}: ${v}`)
        .join('\n');
      return e.error ? `${head}\n${hdrs}\n    error: ${e.error}` : `${head}\n${hdrs}`;
    })
    .join('\n\n');
}

export function clearApiLog() {
  entries.length = 0;
}
