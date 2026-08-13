import React from 'react';

/**
 * Two filters: language code (free-text ISO) and status enum.
 *
 * Status enum mirrors the server's `subtitles.subtitle_status` column:
 *   pending | live | disabled | spam | blacklisted
 *
 * Lightweight by design — no big language dropdown here. The hook in
 * `useLanguageData` is loaded by the upload tab; we don't want to pull it
 * into the history tab just for filter UI.
 */
export function UploadHistoryFilters({ value, onChange }) {
  const setLang = lang =>
    onChange({ ...value, languageCode: lang.trim() ? lang.trim().toLowerCase() : undefined });

  const setStatus = next => onChange({ ...value, status: next === 'all' ? undefined : next });

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-base-content/60">Language</span>
        <input
          type="text"
          maxLength={3}
          placeholder="all"
          aria-label="Language code"
          value={value.languageCode || ''}
          onChange={e => setLang(e.target.value)}
          className="input input-bordered input-sm w-24"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-base-content/60">Status</span>
        <select
          value={value.status || 'all'}
          onChange={e => setStatus(e.target.value)}
          className="select select-bordered select-sm"
        >
          <option value="all">All</option>
          <option value="pending">Pending review</option>
          <option value="live">Live</option>
          <option value="disabled">Disabled</option>
          <option value="spam">Spam</option>
          <option value="blacklisted">Blacklisted</option>
        </select>
      </label>
    </div>
  );
}
