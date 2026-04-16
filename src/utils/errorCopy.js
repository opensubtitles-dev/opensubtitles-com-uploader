/**
 * Pure error_code → user-facing copy mapping. Lives in a .js file (not .jsx)
 * so it can be unit-tested via node:test without a JSX loader.
 *
 * Stable error_code list maintained in tandem with the Rails backend.
 * See docs/plans/07-error-mapping.md.
 */

export const ERROR_COPY = Object.freeze({
  offline:                 { icon: '📡', title: "You're offline", body: 'Reconnect and try again.' },
  network_error:           { icon: '🌐', title: 'Connection issue', body: 'Could not reach the server.' },
  timeout:                 { icon: '⏲️', title: 'Request timed out', body: 'The server took too long to respond. Try again in a moment.' },
  server_error:            { icon: '🔧', title: 'OpenSubtitles is busy', body: 'Try again shortly.' },
  unauthorized:            { icon: '🔒', title: 'Please log in', body: null, showLogin: true },
  banned:                  { icon: '🚫', title: 'Uploads not permitted', body: 'Your client setup has been blocked from uploading. Contact support if you think this is a mistake.' },
  quota_exceeded:          { icon: '⏳', title: 'Daily limit reached', body: "You've hit your daily upload quota. Try again tomorrow, or upgrade for a higher limit." },
  duplicate:               { icon: '♻️', title: 'Already in the database', body: 'This subtitle has been uploaded before.' },
  spam_filename:           { icon: '⚠️', title: 'Filename not allowed', body: 'Try renaming the subtitle file.' },
  spam_content:            { icon: '🗑️', title: 'Subtitle too small', body: 'The subtitle file looks like spam — too small to be valid.' },
  anon_duplicate_language: { icon: '👤', title: 'Not allowed for guests', body: 'Anonymous uploads cannot duplicate an existing language. Log in, or pick a different language.', showLogin: true },
  feature_not_found:       { icon: '🎬', title: 'Movie not in database', body: 'Use "Create new entry" to register a provisional title.' },
  invalid_language:        { icon: '🌐', title: 'Unknown language', body: null },
  invalid_content:         { icon: '❌', title: 'Corrupt subtitle', body: 'The subtitle file could not be read.' },
  invalid_type:            { icon: '📂', title: 'Invalid type', body: 'Type must be movie, tvshow, or episode.' },
  subhash_mismatch:        { icon: '🔄', title: 'File changed during upload', body: 'Please restart the upload.' },
  validation_error:        { icon: '✏️', title: 'Please check the fields', body: null },
  missing_title:           { icon: '📝', title: 'Title is required', body: null },
  not_found:               { icon: '🔍', title: 'Not found', body: null },
  unknown:                 { icon: '❓', title: 'Something went wrong', body: null },
});

/**
 * Resolve a thrown error to display copy. `error.code` is preferred (set by
 * RestError / AuthError); otherwise we synthesize `http_<status>`. Unknown
 * codes fall through to the 'unknown' entry but the body always falls back
 * to `error.message` so the user still sees something useful.
 *
 * @param {Error|RestError|null|undefined} error
 * @returns {{ code: string, title: string, body: string|null, icon: string, showLogin?: boolean } | null}
 */
export function errorCopy(error) {
  if (!error) return null;
  const code = error?.code || (error?.status ? `http_${error.status}` : 'unknown');
  const meta = ERROR_COPY[code] || ERROR_COPY.unknown;
  return {
    code,
    title: meta.title,
    body: meta.body || error?.message || null,
    icon: meta.icon,
    showLogin: !!meta.showLogin,
  };
}
