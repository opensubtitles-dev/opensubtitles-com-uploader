import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
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

export default function UploadHistory() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { isDark } = useTheme();

  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});

  const { data, meta, loading, error, update, remove, refetch } = useMyUploads({
    page,
    perPage: PAGE_SIZE,
    languageCode: filters.languageCode,
    enabled: filters.enabled,
  });

  const containerCls = `min-h-screen ${
    isDark ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'
  }`;

  if (authLoading) {
    return (
      <div className={containerCls}>
        <div className="max-w-4xl mx-auto p-6">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className={containerCls}>
        <div className="max-w-4xl mx-auto p-6 text-center">
          <h1 className="text-2xl font-bold mb-3">Upload history</h1>
          <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>
            Log in to see your upload history.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={containerCls}>
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <header className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold">Upload history</h1>
          {meta?.total_count != null && (
            <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {meta.total_count} upload{meta.total_count === 1 ? '' : 's'}
            </span>
          )}
        </header>

        <UploadHistoryFilters
          value={filters}
          onChange={next => {
            setFilters(next);
            setPage(1);
          }}
        />

        {loading ? (
          <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>Loading…</p>
        ) : error ? (
          <ErrorBanner error={error} onRetry={refetch} />
        ) : data.length === 0 ? (
          <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>
            No uploads yet — drop a subtitle on the upload tab to get started.
          </p>
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
                  className={`px-3 py-1 rounded ${
                    meta.page <= 1
                      ? 'opacity-40'
                      : isDark
                        ? 'hover:bg-gray-800'
                        : 'hover:bg-gray-200'
                  }`}
                >
                  ← Previous
                </button>
                <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>
                  Page {meta.page} of {meta.total_pages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(meta.total_pages, p + 1))}
                  disabled={meta.page >= meta.total_pages}
                  className={`px-3 py-1 rounded ${
                    meta.page >= meta.total_pages
                      ? 'opacity-40'
                      : isDark
                        ? 'hover:bg-gray-800'
                        : 'hover:bg-gray-200'
                  }`}
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
