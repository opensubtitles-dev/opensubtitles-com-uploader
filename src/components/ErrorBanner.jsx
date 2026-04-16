import React from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
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
  const { isDark } = useTheme();
  const copy = errorCopy(error);
  if (!copy) return null;

  const baseCls = isDark
    ? 'bg-red-900/20 border-red-700 text-red-200'
    : 'bg-red-50 border-red-300 text-red-700';

  if (compact) {
    return (
      <div className={`p-2 rounded border text-sm ${baseCls}`} role="alert">
        <span className="font-medium">{copy.title}</span>
        {copy.body && <span className="opacity-80"> — {copy.body}</span>}
      </div>
    );
  }

  return (
    <div className={`p-3 rounded border ${baseCls}`} role="alert">
      <div className="flex items-start gap-3">
        <span aria-hidden="true">{copy.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium">{copy.title}</div>
          {copy.body && <div className="text-sm mt-1 opacity-90">{copy.body}</div>}
          {(onRetry || (copy.showLogin && onLogin)) && (
            <div className="mt-2 flex gap-3">
              {onRetry && (
                <button
                  onClick={onRetry}
                  type="button"
                  className="text-sm underline opacity-90 hover:opacity-100"
                >
                  Try again
                </button>
              )}
              {copy.showLogin && onLogin && (
                <button
                  onClick={onLogin}
                  type="button"
                  className="text-sm underline opacity-90 hover:opacity-100"
                >
                  Log in
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Re-export for back-compat with any caller that imports errorCopy from here
export { errorCopy } from '../utils/errorCopy.js';
