import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';

/**
 * Confirm dialog for DELETE /my/uploads/:id (soft-delete: enabled=false).
 */
export function UploadDeleteConfirm({ subtitle, onConfirm, onCancel }) {
  const { isDark } = useTheme();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err?.message || 'Failed to delete.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={e => e.target === e.currentTarget && !submitting && onCancel()}
    >
      <div
        className={`max-w-sm w-full rounded-lg p-6 space-y-3 ${
          isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
        }`}
      >
        <h2 className="text-lg font-semibold">Delete this upload?</h2>
        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          <span className="font-medium block mb-1">
            {subtitle.release_name || subtitle.subfilename}
          </span>
          The subtitle will be hidden from search results immediately. Moderators
          retain a copy for audit; contact support if you want it permanently
          erased.
        </p>

        {error && (
          <div
            className={`p-3 border rounded text-sm ${
              isDark
                ? 'bg-red-900/20 border-red-700 text-red-200'
                : 'bg-red-50 border-red-300 text-red-700'
            }`}
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className={`px-3 py-2 rounded ${
              isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white"
          >
            {submitting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
