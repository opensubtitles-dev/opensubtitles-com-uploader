---
title: "06 — My Uploads Integration (new history tab)"
aliases: [my-uploads, upload-history, history-tab]
tags: [uploader/history, phase-2]
created: 2026-04-15
status: locked
---

# 06 — My Uploads Integration

> [!INFO] Purpose
> New "Upload history" tab that closes the biggest UX gap in the legacy uploader. Uses the 3 REST endpoints landed in Phase 1 of the Rails backend: `GET/PATCH/DELETE /api/v1/my/uploads`.

## 1. UX sketch

```
┌─────────────────────────────────────────────────────────────┐
│  OpenSubtitles Uploader                              [_][×] │
├─────────────────────────────────────────────────────────────┤
│  [ Upload ]    [ History ]       [ Settings ]   [ Logout ]  │
├─────────────────────────────────────────────────────────────┤
│  Upload History                            Filter: [All ▼] │
│                                            Language: [All ▼]│
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Dune.2021.1080p.BluRay.srt                  [↓ open]   │ │
│  │ Dune (2021) • English • Uploaded 2 hours ago           │ │
│  │ 128 downloads • Flags: HD                              │ │
│  │ [ Edit ]  [ Delete ]                                   │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Matrix.1999.WEB-DL.srt                      [↓ open]   │ │
│  │ The Matrix (1999) • English • Uploaded yesterday       │ │
│  │ ⚠ Flagged for review                                   │ │
│  │ [ Edit ]  [ Delete ]                                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│                 ◀ Prev    Page 1 of 3    Next ▶             │
└─────────────────────────────────────────────────────────────┘
```

## 2. Files to add

```
src/components/history/
├── UploadHistory.jsx          top-level tab content
├── UploadHistoryList.jsx      paginated list
├── UploadHistoryItem.jsx      single row / card
├── UploadEditDialog.jsx       PATCH form
├── UploadDeleteConfirm.jsx    DELETE confirm
└── UploadHistoryFilters.jsx   language + enabled filters

src/hooks/
└── useMyUploads.js            fetch + mutate wrapper
```

## 3. `useMyUploads.js` hook

```js
import { useState, useEffect, useCallback } from 'react';
import { myUploadsApi } from '../services/api/myUploads.js';

export function useMyUploads({ page, perPage, languageCode, enabled } = {}) {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await myUploadsApi.list({ page, perPage, languageCode, enabled });
      setData(r.data);
      setMeta(r.meta);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, [page, perPage, languageCode, enabled]);

  useEffect(() => { fetch(); }, [fetch]);

  const update = useCallback(async (id, patch) => {
    const r = await myUploadsApi.update(id, patch);
    // Optimistic local update
    setData(list => list.map(s => s.subtitle_id === id ? r.subtitle : s));
    return r;
  }, []);

  const remove = useCallback(async (id) => {
    await myUploadsApi.remove(id);
    setData(list => list.filter(s => s.subtitle_id !== id));
    if (meta) setMeta({ ...meta, total_count: meta.total_count - 1 });
  }, [meta]);

  return { data, meta, loading, error, refetch: fetch, update, remove };
}
```

## 4. `UploadHistory.jsx`

```jsx
export default function UploadHistory() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const { data, meta, loading, error, update, remove, refetch } = useMyUploads({ page, perPage: 20, ...filters });

  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <div className="empty-state">Log in to see your upload history.</div>;
  }

  if (loading) return <Spinner label="Loading uploads..." />;
  if (error)   return <ErrorBanner error={error} onRetry={refetch} />;
  if (!data?.length) return <EmptyState label="No uploads yet — upload your first subtitle!" />;

  return (
    <div className="upload-history">
      <UploadHistoryFilters value={filters} onChange={setFilters} />
      <UploadHistoryList items={data} onUpdate={update} onDelete={remove} />
      <Pagination page={meta.page} total={meta.total_pages} onPage={setPage} />
    </div>
  );
}
```

## 5. `UploadHistoryItem.jsx`

```jsx
export default function UploadHistoryItem({ item, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <article className={`upload-card ${item.status}`}>
      <header>
        <h3>{item.release_name || item.subfilename}</h3>
        <a href={item.download_url} target="_blank" rel="noreferrer">Open ↗</a>
      </header>
      <dl className="meta">
        <dd>{item.language_code?.toUpperCase()}</dd>
        <dd>Uploaded {timeAgo(item.upload_date)}</dd>
        <dd>{item.download_count ?? 0} downloads</dd>
      </dl>
      {item.status === 'flagged_for_review' && (
        <p className="warning">⚠ Flagged for moderator review</p>
      )}
      <footer>
        <button onClick={() => setEditing(true)}>Edit</button>
        <button onClick={() => setConfirming(true)} className="danger">Delete</button>
      </footer>
      {editing && (
        <UploadEditDialog
          subtitle={item}
          onSave={async p => { await onUpdate(item.subtitle_id, p); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      )}
      {confirming && (
        <UploadDeleteConfirm
          subtitle={item}
          onConfirm={async () => { await onDelete(item.subtitle_id); setConfirming(false); }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </article>
  );
}
```

## 6. Editable fields

From `02-endpoint-mapping` / Rails `My::UploadsController#update_params`:

- `release_name` — text
- `movie_aka` — text
- `translator` — text
- `author_comments` — textarea
- `hearing_impaired` — checkbox
- `hd` — checkbox
- `foreign_parts_only` — checkbox
- `automatic_translation` — checkbox
- `machine_translated` — checkbox

**Not editable client-side** (server rejects):
- `subtitle_id`, `subfile_id`, `feature_id` — immutable
- `osdb_language_id` — locked (changing language would be a different subtitle)
- `subhash` / `byte_size` / `upload_date` — derived
- `admin_check` / `enabled` — only admins can flip these

## 7. Navigation wiring

Add a new route via `react-router-dom`:

```jsx
// src/App.jsx
<Route path="/upload"  element={<SubtitleUploader />} />
<Route path="/history" element={<UploadHistory />} />   // NEW
<Route path="/config"  element={<ConfigOverlay />} />
```

Tab component renders `Link`s to `/upload` and `/history`. Active tab highlighted via `NavLink`'s `aria-current`.

## 8. Empty states

- **Not logged in** — "Log in to see your upload history." + login CTA
- **Anonymous** (logged in but has no uploads) — "No uploads yet — upload your first subtitle!"
- **Filtered to zero** — "No uploads match this filter." + clear-filters button
- **Network error** — error banner + retry button

## 9. Accessibility

- All cards keyboard-navigable; edit + delete are real `<button>`s
- Edit dialog is modal with focus trap + Escape to close
- Delete confirmation uses `aria-describedby` to announce the risk
- Pagination uses `<nav aria-label="pagination">`

## 10. i18n

Each user-facing string behind an i18n key. The existing app doesn't seem to have an i18n framework wired yet — we'll add one in [[09-migration-sequence]] as a separate step. For now, strings are literals; extraction to locale files is a tracked TODO.

> [!TODO] i18n framework
> Pick: `react-i18next` vs lightweight custom. Current uploader is English-only. The Rails backend supports full i18n — the uploader should eventually match. Ship Phase 2 English-only, add i18n in a follow-up.

## 11. Local optimizations

- Use `Intl.RelativeTimeFormat` for "2 hours ago" (native, zero deps)
- List virtualization NOT needed — we paginate 20 per page server-side
- Debounce filter changes (300 ms) so typing in language filter doesn't spam the API

## 12. Edge cases

- **User deletes their own anonymous upload** — anonymous uploads have `uploader_id: nil`, so they simply don't show in `/my/uploads`. No button to tap → no edge case. Anon users who want their upload taken down contact support.
- **User edits a subtitle that's `flagged_for_review`** — still allowed; the flag just adds a visual indicator.
- **User edits a subtitle that was deleted by admin** — server returns 404 because `load_subtitle!` filters on `uploader_id` only; but if `enabled=false` and admins haven't soft-deleted it, still editable. If admins hard-delete, 404. Handle both by refetching the list on error.
- **Race: two tabs open** — optimistic updates in `useMyUploads` are local. If the server rejects, we refetch + display an error toast.

## 13. Checklist

- [ ] `myUploadsApi` methods (already in [[04-rest-client-refactor]])
- [ ] `useMyUploads` hook with pagination, filters, update, remove
- [ ] `UploadHistory` tab wired into router
- [ ] `UploadHistoryList` + `UploadHistoryItem` components
- [ ] `UploadEditDialog` form bound to PATCH
- [ ] `UploadDeleteConfirm` confirm bound to DELETE
- [ ] `UploadHistoryFilters` — language + enabled toggle
- [ ] Empty / loading / error states
- [ ] Pagination
- [ ] Relative-time formatting
- [ ] Manual smoke on staging (golden replay in [[08-testing-strategy]])

## 14. Follow-ups after Phase 2

- Replace-file flow (`POST /my/uploads/:id/replace`) when backend ships
- i18n extraction
- "Bulk actions" (multi-select + bulk delete) — only once volume justifies it
