import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { errorCopy } from '../utils/errorCopy.js';

/**
 * Canonical error banner. Routes through `errorCopy()` for the code → title/body
 * mapping. See docs/plans/07-error-mapping.md.
 *
 * Props:
 *   error    : Error|RestError|null   the thrown error or null/undefined
 *   onRetry? : () => void             show a Retry button
 *   onLogin? : () => void             show a Login button (for auth-related codes)
 *   compact? : boolean                small inline variant (no icon, smaller text)
 */
export function ErrorBanner({ error, onRetry, onLogin, compact = false }) {
  const copy = errorCopy(error);
  if (!copy) return null;

  if (compact) {
    return (
      <div
        role="alert"
        className="rounded-md border border-error/40 bg-error/10 text-error px-2 py-1.5 text-sm"
      >
        <span className="font-medium">{copy.title}</span>
        {copy.body && <span className="opacity-80"> — {copy.body}</span>}
      </div>
    );
  }

  return (
    <div role="alert" className="alert alert-error">
      <AlertTriangle className="size-5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium">{copy.title}</div>
        {copy.body && <div className="text-sm mt-1 opacity-90">{copy.body}</div>}
        {(onRetry || (copy.showLogin && onLogin)) && (
          <div className="mt-2 flex gap-2">
            {onRetry && (
              <button onClick={onRetry} type="button" className="btn btn-xs btn-ghost">
                Try again
              </button>
            )}
            {copy.showLogin && onLogin && (
              <button onClick={onLogin} type="button" className="btn btn-xs btn-ghost">
                Log in
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export for back-compat with any caller that imports errorCopy from here
export { errorCopy } from '../utils/errorCopy.js';
