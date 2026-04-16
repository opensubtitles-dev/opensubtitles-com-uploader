import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';

/**
 * Modal form to PATCH /my/uploads/:id. Editable fields are exactly the
 * server-side `update_params` allowlist:
 *   release_name, movie_aka, translator, author_comments,
 *   hearing_impaired, hd, foreign_parts_only,
 *   automatic_translation, machine_translated.
 */
export function UploadEditDialog({ subtitle, onSave, onCancel }) {
  const { isDark } = useTheme();

  const [form, setForm] = useState({
    release_name: subtitle.release_name || '',
    movie_aka: subtitle.movie_aka || '',
    translator: subtitle.translator || '',
    author_comments: subtitle.author_comments || '',
    hearing_impaired: !!subtitle.hearing_impaired,
    hd: !!subtitle.hd,
    foreign_parts_only: !!subtitle.foreign_parts_only,
    automatic_translation: !!subtitle.automatic_translation,
    machine_translated: !!subtitle.machine_translated,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSave(form);
    } catch (err) {
      setError(err?.message || 'Failed to save changes.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = `w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    isDark
      ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
  }`;
  const labelCls = `block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`;

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
        <h2 className="text-lg font-semibold">
          Edit upload <span className="opacity-60">#{subtitle.subtitle_id}</span>
        </h2>

        {error && (
          <div
            className={`p-3 border rounded ${
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
            <label htmlFor="release_name" className={labelCls}>
              Release name
            </label>
            <input
              id="release_name"
              type="text"
              className={inputCls}
              value={form.release_name}
              onChange={e => update('release_name', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="movie_aka" className={labelCls}>
              Movie also-known-as
            </label>
            <input
              id="movie_aka"
              type="text"
              className={inputCls}
              value={form.movie_aka}
              onChange={e => update('movie_aka', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="translator" className={labelCls}>
              Translator
            </label>
            <input
              id="translator"
              type="text"
              className={inputCls}
              value={form.translator}
              onChange={e => update('translator', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="author_comments" className={labelCls}>
              Comments
            </label>
            <textarea
              id="author_comments"
              rows={3}
              className={inputCls}
              value={form.author_comments}
              onChange={e => update('author_comments', e.target.value)}
            />
          </div>

          <fieldset className="space-y-1.5">
            <legend className={labelCls}>Flags</legend>
            {[
              ['hearing_impaired', 'Hearing impaired (HI / SDH)'],
              ['hd', 'High definition'],
              ['foreign_parts_only', 'Foreign parts only'],
              ['machine_translated', 'Machine translated'],
              ['automatic_translation', 'Automatic translation'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={e => update(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </fieldset>

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
              disabled={submitting}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white"
            >
              {submitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
