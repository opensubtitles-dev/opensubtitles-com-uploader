import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
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
  const { isAuthenticated } = useAuth();

  const [form, setForm] = useState({
    title: initialTitle,
    year: '',
    type: 'movie',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

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
      const movieGuess = {
        imdbid: null,
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={e => e.target === e.currentTarget && !submitting && onCancel()}
    >
      <div className="modal-box w-full max-w-md bg-base-100 p-6 space-y-3">
        <h2 className="text-lg font-semibold text-base-content">Create new entry</h2>
        <p className="text-sm text-base-content/70">
          The movie or show isn't in our database yet. Create a provisional entry — a moderator will
          review it shortly and you can upload subtitles against it immediately.
        </p>

        {!isAuthenticated && (
          <div role="alert" className="alert alert-warning">
            <AlertTriangle className="size-5 shrink-0" />
            <span>You need to be logged in to create a new entry.</span>
          </div>
        )}

        {error && (
          <div role="alert" className="alert alert-error">
            <AlertTriangle className="size-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              htmlFor="stub_title"
              className="block text-sm font-medium text-base-content mb-1"
            >
              Title <span className="text-error">*</span>
            </label>
            <input
              id="stub_title"
              type="text"
              required
              autoFocus
              className="input input-bordered w-full"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. My Indie Documentary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="stub_year"
                className="block text-sm font-medium text-base-content mb-1"
              >
                Year
              </label>
              <input
                id="stub_year"
                type="number"
                min="1888"
                max="2100"
                className="input input-bordered w-full"
                value={form.year}
                onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                placeholder={String(new Date().getFullYear())}
              />
            </div>
            <div>
              <label
                htmlFor="stub_type"
                className="block text-sm font-medium text-base-content mb-1"
              >
                Type
              </label>
              <select
                id="stub_type"
                className="select select-bordered w-full"
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
              className="btn btn-sm btn-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !isAuthenticated || !form.title.trim()}
              className="btn btn-sm btn-primary"
            >
              {submitting ? 'Creating…' : 'Create entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
