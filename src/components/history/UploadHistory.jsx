import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useMyUploads } from '../../hooks/useMyUploads.js';
import { UploadHistoryList } from './UploadHistoryList.jsx';
import { UploadHistoryFilters } from './UploadHistoryFilters.jsx';
import { ErrorBanner } from '../ErrorBanner.jsx';

/**
 * Top-level upload history tab.
 *
 * GET /api/v1/my/uploads — paginated list, edit, soft-delete.
 * Anonymous users see a CTA to log in (server-side: anon uploads have
 * uploader_id: nil and don't appear in /my/uploads).
 */
const PAGE_SIZE = 20;

const BackLink = () => (
  <a href="#/" className="btn btn-ghost btn-sm gap-2" title="Back to uploader">
    <ArrowLeft className="size-4" />
    <span>Back to uploader</span>
  </a>
);

export default function UploadHistory() {
  const { isAuthenticated, loading: authLoading } = useAuth();

  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});

  const { data, meta, loading, error, update, remove, refetch } = useMyUploads({
    page,
    perPage: PAGE_SIZE,
    languageCode: filters.languageCode,
    status: filters.status,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-base-200 p-6">
        <div className="max-w-4xl mx-auto">
          <BackLink />
          <p className="text-base-content/70 mt-6">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-base-200 p-6">
        <div className="max-w-4xl mx-auto">
          <BackLink />
          <div className="card bg-base-100 shadow-sm mt-4 p-6 text-center">
            <h1 className="text-2xl font-semibold mb-3 text-base-content">Upload history</h1>
            <p className="text-base-content/70">Log in to see your upload history.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BackLink />
            <h1 className="text-2xl font-semibold text-base-content">Upload history</h1>
          </div>
          {meta?.total_count != null && (
            <span className="text-sm text-base-content/60">
              {meta.total_count} upload{meta.total_count === 1 ? '' : 's'}
            </span>
          )}
        </header>

        <div className="card bg-base-100 shadow-sm p-4">
          <UploadHistoryFilters
            value={filters}
            onChange={next => {
              setFilters(next);
              setPage(1);
            }}
          />
        </div>

        {loading ? (
          <p className="text-base-content/70">Loading…</p>
        ) : error ? (
          <ErrorBanner error={error} onRetry={refetch} />
        ) : data.length === 0 ? (
          <div className="card bg-base-100 shadow-sm p-6 text-center">
            <p className="text-base-content/70">
              No uploads yet — drop a subtitle on the upload tab to get started.
            </p>
          </div>
        ) : (
          <>
            <UploadHistoryList items={data} onUpdate={update} onDelete={remove} />
            {meta && meta.total_pages > 1 && (
              <nav
                aria-label="Pagination"
                className="flex items-center justify-between pt-2 text-sm"
              >
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={meta.page <= 1}
                  className="btn btn-ghost btn-sm"
                >
                  ← Previous
                </button>
                <span className="text-base-content/60">
                  Page {meta.page} of {meta.total_pages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(meta.total_pages, p + 1))}
                  disabled={meta.page >= meta.total_pages}
                  className="btn btn-ghost btn-sm"
                >
                  Next →
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
