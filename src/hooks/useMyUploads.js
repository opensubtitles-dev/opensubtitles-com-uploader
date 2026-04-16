import { useState, useEffect, useCallback, useRef } from 'react';
import { myUploadsApi } from '../services/api/myUploads.js';

/**
 * Hook for the user's upload history.
 *
 * - Fetches the current page on mount and whenever pagination/filters change
 * - Refetch on demand via `refetch()`
 * - Optimistic local update / remove with server roundtrip
 * - In-flight cancellation via AbortController on rapid filter changes
 *
 * Errors caught here include `RestError` (with `code` + `status`) so the UI
 * can route them through ErrorBanner. Any 401 mid-fetch is also routed via
 * `osdb:auth-expired` (handled by AuthContext globally).
 */
export function useMyUploads({ page = 1, perPage = 20, languageCode, enabled } = {}) {
  const [data, setData] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);

  const fetchPage = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const r = await myUploadsApi.list({
        page,
        perPage,
        languageCode,
        enabled,
        signal: controller.signal,
      });
      setData(Array.isArray(r?.data) ? r.data : []);
      setMeta(r?.meta || null);
    } catch (err) {
      if (err?.code === 'aborted' || err?.name === 'AbortError') return;
      setError(err);
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [page, perPage, languageCode, enabled]);

  useEffect(() => {
    fetchPage();
    return () => abortRef.current?.abort();
  }, [fetchPage]);

  /**
   * Update a single subtitle. Optimistically merges the server response into
   * the local list. Throws on failure so the dialog can display an inline error.
   */
  const update = useCallback(async (id, patch) => {
    const r = await myUploadsApi.update(id, patch);
    setData(list => list.map(s => (s.subtitle_id === id ? r.subtitle || s : s)));
    return r;
  }, []);

  /**
   * Soft-delete. Optimistically removes from local list + decrements total.
   * On server error the row stays gone locally — the next refetch will
   * restore it if the deletion didn't actually happen.
   */
  const remove = useCallback(
    async id => {
      await myUploadsApi.remove(id);
      setData(list => list.filter(s => s.subtitle_id !== id));
      if (meta) {
        setMeta({ ...meta, total_count: Math.max(0, (meta.total_count || 0) - 1) });
      }
    },
    [meta]
  );

  return { data, meta, loading, error, refetch: fetchPage, update, remove };
}
