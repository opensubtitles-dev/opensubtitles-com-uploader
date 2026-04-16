import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { UploadEditDialog } from './UploadEditDialog.jsx';
import { UploadDeleteConfirm } from './UploadDeleteConfirm.jsx';

const RTF =
  typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function'
    ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    : null;

const RANGES = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

function timeAgo(iso) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  if (!RTF) return new Date(ts).toLocaleString();
  const diffSec = (ts - Date.now()) / 1000;
  for (const [unit, sec] of RANGES) {
    const v = diffSec / sec;
    if (Math.abs(v) >= 1) return RTF.format(Math.round(v), unit);
  }
  return RTF.format(Math.round(diffSec), 'second');
}

export function UploadHistoryItem({ item, onUpdate, onDelete }) {
  const { isDark } = useTheme();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const cardCls = `border rounded-lg p-4 ${
    isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
  }`;
  const subtleCls = isDark ? 'text-gray-400' : 'text-gray-500';

  const flagged = item.status === 'flagged_for_review';
  const disabled = item.enabled === false;

  return (
    <article className={cardCls}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{item.release_name || item.subfilename || `#${item.subtitle_id}`}</h3>
          <div className={`text-sm ${subtleCls} mt-0.5 flex flex-wrap gap-x-3`}>
            <span>{item.language_code?.toUpperCase() || '—'}</span>
            <span>Uploaded {timeAgo(item.upload_date) || '—'}</span>
            <span>{item.download_count ?? 0} downloads</span>
          </div>
          {(flagged || disabled) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {flagged && (
                <span className="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800">
                  ⚠ Flagged for review
                </span>
              )}
              {disabled && !flagged && (
                <span className="px-2 py-0.5 text-xs rounded bg-gray-200 text-gray-700">
                  Disabled
                </span>
              )}
            </div>
          )}
        </div>
        {item.download_url && (
          <a
            href={item.download_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`shrink-0 text-sm underline ${
              isDark ? 'text-blue-300 hover:text-blue-200' : 'text-blue-600 hover:text-blue-800'
            }`}
          >
            Open ↗
          </a>
        )}
      </header>

      <footer className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`text-sm px-3 py-1 rounded border ${
            isDark
              ? 'border-gray-600 hover:bg-gray-700'
              : 'border-gray-300 hover:bg-gray-100'
          }`}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className={`text-sm px-3 py-1 rounded border ${
            isDark
              ? 'border-red-700 text-red-300 hover:bg-red-900/30'
              : 'border-red-300 text-red-700 hover:bg-red-50'
          }`}
        >
          Delete
        </button>
      </footer>

      {editing && (
        <UploadEditDialog
          subtitle={item}
          onSave={async patch => {
            await onUpdate(item.subtitle_id, patch);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {confirmingDelete && (
        <UploadDeleteConfirm
          subtitle={item}
          onConfirm={async () => {
            await onDelete(item.subtitle_id);
            setConfirmingDelete(false);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </article>
  );
}
