import React from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';

/**
 * Two filters: language code (free-text 3-letter ISO) and enabled/disabled.
 * Server-side `language_code` is matched exactly against `osdb_languages.language_code`.
 *
 * Lightweight by design — no big language dropdown here. The hook in
 * `useLanguageData` is loaded by the upload tab; we don't want to pull it
 * into the history tab just for filter UI.
 */
export function UploadHistoryFilters({ value, onChange }) {
  const { isDark } = useTheme();

  const inputCls = `px-2 py-1 border rounded text-sm ${
    isDark
      ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
  }`;

  const setLang = lang =>
    onChange({ ...value, languageCode: lang.trim() ? lang.trim().toLowerCase() : undefined });

  const setEnabled = next =>
    onChange({ ...value, enabled: next === 'all' ? undefined : next === 'true' });

  const enabledStr = value.enabled === undefined ? 'all' : value.enabled ? 'true' : 'false';

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Language</span>
        <input
          type="text"
          maxLength={3}
          placeholder="all"
          aria-label="Language code"
          value={value.languageCode || ''}
          onChange={e => setLang(e.target.value)}
          className={`${inputCls} w-20`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Status</span>
        <select
          value={enabledStr}
          onChange={e => setEnabled(e.target.value)}
          className={inputCls}
        >
          <option value="all">All</option>
          <option value="true">Active</option>
          <option value="false">Disabled</option>
        </select>
      </label>
    </div>
  );
}
