import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { uploadApi } from '../services/api/upload.js';

/**
 * "Movie not in database? Create new entry" dialog.
 *
 * Calls POST /api/v1/subtitles/upload/features/stub which creates a
 * provisional feature (enabled=false, provisional=true) on the server.
 * A moderator reviews + links it to a real IMDb/TMDb id later. The
 * uploader can immediately attach a subtitle to the new feature_id.
 *
 * Requires a logged-in user (server returns 401 for anonymous).
 */
export function StubFeatureDialog({ initialTitle = '', onCreated, onCancel }) {
  const { isDark } = useTheme();
  const { isAuthenticated } = useAuth();

  const [form, setForm] = useState({
    title: initialTitle,
    year: '',
    type: 'movie',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const inputCls = `w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    isDark
      ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
  }`;
  const labelCls = `block text-sm font-medium mb-1 ${
    isDark ? 'text-gray-300' : 'text-gray-700'
  }`;

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const yearInt = form.year ? parseInt(form.year, 10) : undefined;
      const result = await uploadApi.createStubFeature({
        title: form.title.trim(),
        year: Number.isFinite(yearInt) ? yearInt : undefined,
        type: form.type,
      });
      // Wrap into the same shape the rest of the app uses
      const movieGuess = {
        imdbid: null, // stub features don't have an IMDb id yet
        title: result.title || form.title.trim(),
        year: result.year || yearInt || null,
        kind: (result.type || form.type).toLowerCase(),
        reason: 'User created provisional entry',
        feature_id: result.feature_id,
        provisional: true,
      };
      onCreated(movieGuess, result);
    } catch (err) {
      if (err?.code === 'unauthorized' || err?.status === 401) {
        setError('You must be logged in to register a new title.');
      } else if (err?.code === 'missing_title') {
        setError('Title is required.');
      } else if (err?.code === 'invalid_type') {
        setError('Type must be movie, tvshow, or episode.');
      } else if (err?.code === 'validation_error') {
        setError(err.message || 'The server rejected this entry.');
      } else {
        setError(err?.message || 'Failed to create provisional entry.');
      }
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
        className={`max-w-md w-full rounded-lg p-6 space-y-3 ${
          isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
        }`}
      >
        <h2 className="text-lg font-semibold">Create new entry</h2>
        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          The movie or show isn’t in our database yet. Create a provisional
          entry — a moderator will review it shortly and you can upload
          subtitles against it immediately.
        </p>

        {!isAuthenticated && (
          <div
            className={`p-3 border rounded text-sm ${
              isDark
                ? 'bg-amber-900/20 border-amber-700 text-amber-200'
                : 'bg-amber-50 border-amber-300 text-amber-800'
            }`}
          >
            ⚠ You need to be logged in to create a new entry.
          </div>
        )}

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

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="stub_title" className={labelCls}>
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="stub_title"
              type="text"
              required
              autoFocus
              className={inputCls}
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. My Indie Documentary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="stub_year" className={labelCls}>
                Year
              </label>
              <input
                id="stub_year"
                type="number"
                min="1888"
                max="2100"
                className={inputCls}
                value={form.year}
                onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                placeholder={String(new Date().getFullYear())}
              />
            </div>
            <div>
              <label htmlFor="stub_type" className={labelCls}>
                Type
              </label>
              <select
                id="stub_type"
                className={inputCls}
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              >
                <option value="movie">Movie</option>
                <option value="tvshow">TV show</option>
                <option value="episode">Episode</option>
              </select>
            </div>
          </div>

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
              type="submit"
              disabled={submitting || !isAuthenticated || !form.title.trim()}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white"
            >
              {submitting ? 'Creating…' : 'Create entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
