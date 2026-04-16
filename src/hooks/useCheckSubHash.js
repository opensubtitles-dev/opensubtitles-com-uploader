import { useState, useCallback } from 'react';
import { uploadApi } from '../services/api/upload.js';
import { SubtitleHashService } from '../services/subtitleHash.js';
import { isSubtitleFile } from '../utils/fileUtils.js';

/**
 * Hook for the early-stage "is this subtitle already in the database?" check.
 *
 * Replaces the legacy XML-RPC CheckSubHash batch call. The new REST endpoint
 * (`POST /api/v1/subtitles/upload/check`) is per-file rather than batched and
 * returns more than just dedup info — but for this hook's purpose we only
 * surface the `already_in_db` boolean. Other server signals (quota,
 * flags_suggested, rejection_reasons) are evaluated later in the upload flow
 * once the full payload (language, feature, etc.) is known.
 *
 * Errors that mean "we don't know yet because other payload fields are
 * missing" (`invalid_language`, `feature_not_found`, `validation_error`)
 * collapse to status: 'unknown' — they are NOT treated as dedup failures.
 *
 * See docs/plans/02-endpoint-mapping.md §E8 + §E9.
 */
export const useCheckSubHash = addDebugInfo => {
  const [hashCheckResults, setHashCheckResults] = useState({});
  const [hashCheckLoading, setHashCheckLoading] = useState(false);
  const [hashCheckProcessed, setHashCheckProcessed] = useState(false);

  const processSubtitleHashes = useCallback(
    async files => {
      if (!files || files.length === 0) return;

      const subtitleFiles = files.filter(file => isSubtitleFile(file.name) && !file.shouldRemove);
      if (subtitleFiles.length === 0) {
        addDebugInfo && addDebugInfo('📝 [Check] No subtitle files found to check');
        return;
      }

      setHashCheckLoading(true);
      setHashCheckProcessed(false);
      addDebugInfo && addDebugInfo(`📝 [Check] Processing ${subtitleFiles.length} subtitle files...`);

      try {
        const results = {};

        // 1) Hash each subtitle file locally
        for (const file of subtitleFiles) {
          try {
            const hashResult = await SubtitleHashService.readAndHashSubtitleFile(file.file || file);
            results[file.fullPath] = {
              filename: file.name,
              hash: hashResult.hash,
              size: hashResult.size,
              status: 'pending',
            };
          } catch (error) {
            addDebugInfo &&
              addDebugInfo(`❌ [Check] Hash failed for ${file.name}: ${error.message}`);
            results[file.fullPath] = {
              filename: file.name,
              hash: null,
              status: 'error',
              error: error.message,
            };
          }
        }

        // 2) Probe the REST /check endpoint per file
        for (const file of subtitleFiles) {
          const entry = results[file.fullPath];
          if (!entry || !entry.hash) continue;

          try {
            const r = await uploadApi.check(
              {
                subhash: entry.hash,
                subfilename: entry.filename,
                // Placeholder — the dedup happens before language validation
                // server-side (see upload.js#check docstring).
                sublanguageid: 'eng',
              },
              { anonymous: true }
            );

            if (r?.already_in_db) {
              entry.status = 'exists';
              entry.subtitleId = r.duplicate_of ?? null;
              entry.subtitleUrl = r.feature?.url ?? null;
              entry.apiResponse = r;
              addDebugInfo &&
                addDebugInfo(`📝 [Check] ${entry.filename} - exists (ID: ${entry.subtitleId})`);
            } else {
              entry.status = 'new';
              entry.apiResponse = r;
            }
          } catch (apiError) {
            // Errors that just mean "the rest of the payload isn't ready yet"
            // → treat as "not yet known" rather than as failure of dedup.
            const benignCodes = new Set([
              'invalid_language',
              'feature_not_found',
              'validation_error',
            ]);
            if (apiError?.code && benignCodes.has(apiError.code)) {
              entry.status = 'unknown';
              addDebugInfo &&
                addDebugInfo(
                  `📝 [Check] ${entry.filename} - dedup deferred (${apiError.code})`
                );
            } else if (apiError?.code === 'duplicate') {
              // 409 — duplicate detected via commit-race path
              entry.status = 'exists';
              entry.subtitleId = apiError?.details?.duplicate_of ?? null;
              entry.apiResponse = apiError?.details ?? null;
            } else {
              entry.status = 'api_error';
              entry.error = apiError?.message ?? 'Unknown error';
              addDebugInfo &&
                addDebugInfo(`❌ [Check] API call failed for ${entry.filename}: ${entry.error}`);
            }
          }
        }

        setHashCheckResults(results);
        setHashCheckProcessed(true);

        const summary = Object.values(results).reduce((acc, r) => {
          acc[r.status] = (acc[r.status] || 0) + 1;
          return acc;
        }, {});
        addDebugInfo && addDebugInfo(`✅ [Check] Complete. Summary: ${JSON.stringify(summary)}`);
      } catch (error) {
        addDebugInfo && addDebugInfo(`❌ [Check] Processing failed: ${error.message}`);
      } finally {
        setHashCheckLoading(false);
      }
    },
    [addDebugInfo]
  );

  const getHashCheckResult = useCallback(
    filePath => hashCheckResults[filePath] || null,
    [hashCheckResults]
  );

  const fileExistsInDatabase = useCallback(
    filePath => hashCheckResults[filePath]?.status === 'exists',
    [hashCheckResults]
  );

  const getHashCheckSummary = useCallback(() => {
    const summary = Object.values(hashCheckResults).reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    return {
      total: Object.keys(hashCheckResults).length,
      exists: summary.exists || 0,
      new: summary.new || 0,
      pending: summary.pending || 0,
      error: summary.error || 0,
      api_error: summary.api_error || 0,
      unknown: summary.unknown || 0,
    };
  }, [hashCheckResults]);

  const clearHashCheckResults = useCallback(() => {
    setHashCheckResults({});
    setHashCheckProcessed(false);
  }, []);

  return {
    hashCheckResults,
    hashCheckLoading,
    hashCheckProcessed,
    processSubtitleHashes,
    getHashCheckResult,
    fileExistsInDatabase,
    getHashCheckSummary,
    clearHashCheckResults,
  };
};
