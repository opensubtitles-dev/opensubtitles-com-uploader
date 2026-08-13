import React, { useState } from 'react';
import { UploadEditDialog } from './UploadEditDialog.jsx';
import { UploadDeleteConfirm } from './UploadDeleteConfirm.jsx';

// Mirrors Rails `Subtitle::SUBTITLE_STATUSES` — keep in sync with
// app/models/subtitle.rb if the server enum grows.
const STATUS_BADGE = {
  pending: { cls: 'badge badge-warning badge-sm', label: 'Pending review' },
  live: { cls: 'badge badge-success badge-sm', label: 'Live' },
  disabled: { cls: 'badge badge-ghost badge-sm', label: 'Disabled' },
  spam: { cls: 'badge badge-error badge-sm', label: 'Spam' },
  blacklisted: { cls: 'badge badge-error badge-sm', label: 'Blacklisted' },
};

function statusFor(item) {
  if (item.status && STATUS_BADGE[item.status]) return item.status;
  return item.enabled === false ? 'disabled' : 'live';
}

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
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const status = statusFor(item);
  const badge = STATUS_BADGE[status];

  return (
    <article className="card bg-base-100 shadow-sm">
      <div className="card-body p-4 gap-3">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate text-base-content">
                {item.release_name || item.subfilename || `#${item.subtitle_id}`}
              </h3>
              <span className={badge.cls} title={`Status: ${badge.label}`}>
                {badge.label}
              </span>
            </div>
            <div className="text-sm text-base-content/60 mt-1 flex flex-wrap gap-x-3">
              <span>{item.language_code?.toUpperCase() || '—'}</span>
              <span>Uploaded {timeAgo(item.upload_date) || '—'}</span>
              <span>{item.download_count ?? 0} downloads</span>
            </div>
          </div>
          {item.download_url && (
            <a
              href={item.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-sm link link-primary"
            >
              Open ↗
            </a>
          )}
        </header>

        <footer className="flex gap-2">
          <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="btn btn-ghost btn-sm text-error"
          >
            Delete
          </button>
        </footer>
      </div>

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
