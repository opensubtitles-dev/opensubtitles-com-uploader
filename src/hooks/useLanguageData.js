import { useState, useEffect, useCallback, useRef } from 'react';
import { OpenSubtitlesApiService } from '../services/api/openSubtitlesApi.js';
import { languagesApi } from '../services/api/languages.js';
import { retryAsync } from '../utils/retryUtils.js';

/**
 * Custom hook for managing language data from two REST sources:
 *
 *   1. `OpenSubtitlesApiService.getSupportedLanguages()` (FastText) → display
 *      metadata (flag, name, originalName, iso639_3) for ALL languages we know
 *      about. Used for showing flags + display names.
 *
 *   2. `languagesApi.list()` (`/api/v1/infos/languages`) → upload-enabled set.
 *      The server-side endpoint already filters `upload_enabled=true`, so any
 *      code returned here is valid for the upload payload's `sublanguageid`.
 *
 * The hook merges them into `combinedLanguages`, where each entry has:
 *   - `flag`, `originalName`, `iso639_3` from FastText (when available)
 *   - `language_code`, `displayName` always present
 *   - `canUpload` true iff the language appears in the upload-enabled list
 *
 * This replaces the legacy XML-RPC `GetSubLanguages` flow + the singleton
 * "wait for both APIs then combine" dance. See
 * docs/plans/02-endpoint-mapping.md §E4 and 04-rest-client-refactor.md §7.
 */
export const useLanguageData = addDebugInfo => {
  const [languageMap, setLanguageMap] = useState({});         // FastText (display)
  const [uploadLanguages, setUploadLanguages] = useState([]); // upload-enabled
  const [combinedLanguages, setCombinedLanguages] = useState({});
  const [languagesLoading, setLanguagesLoading] = useState(true);
  const [languagesError, setLanguagesError] = useState(null);
  const [subtitleLanguages, setSubtitleLanguages] = useState({});

  // Prevent double-fetches in React StrictMode
  const fetchedRef = useRef(false);
  // Stable debug logger ref so useCallback deps don't churn
  const debugRef = useRef(addDebugInfo);
  debugRef.current = addDebugInfo;
  const debug = useCallback(msg => debugRef.current && debugRef.current(msg), []);

  // -------------------------------------------------------------------------
  // Loaders
  // -------------------------------------------------------------------------

  const loadDisplayLanguages = useCallback(async () => {
    debug('📥 Loading display languages (FastText)...');
    const { data, fromCache } = await retryAsync(
      () => OpenSubtitlesApiService.getSupportedLanguages(),
      3,
      5000,
      attempt => attempt > 1 && debug(`🔄 FastText retry ${attempt}/3...`)
    );
    setLanguageMap(data);
    debug(`✅ Display: ${Object.keys(data).length} languages ${fromCache ? '(cached)' : '(API)'}`);
    return data;
  }, [debug]);

  const loadUploadLanguages = useCallback(async () => {
    debug('📥 Loading upload-enabled languages (/infos/languages)...');
    const { data, fromCache } = await retryAsync(
      () => languagesApi.list(),
      3,
      2000,
      attempt => attempt > 1 && debug(`🔄 /infos/languages retry ${attempt}/3...`)
    );
    setUploadLanguages(data);
    debug(`✅ Upload: ${data.length} languages ${fromCache ? '(cached)' : '(API)'}`);
    return data;
  }, [debug]);

  // -------------------------------------------------------------------------
  // Combine — runs whenever both sources have produced data
  // -------------------------------------------------------------------------

  const combineLanguageData = useCallback(
    (displayMap, uploadList) => {
      const combined = {};
      const uploadCodes = new Set();

      // Index upload list by ISO code (all entries get canUpload: true)
      for (const lang of uploadList) {
        const code = lang.language_code.toLowerCase();
        uploadCodes.add(code);
        const displayLang = displayMap[code];
        combined[code] = {
          language_code: code,
          displayName: displayLang?.name || lang.language_name,
          flag: displayLang?.flag || '🏳️',
          originalName: displayLang?.originalName || '',
          iso639_3: displayLang?.iso639_3 || '',
          canUpload: true,
        };
      }

      // Add display-only languages (canUpload: false) — useful for showing the
      // detected language in dropdowns even if user can't upload it
      for (const [code, displayLang] of Object.entries(displayMap)) {
        if (code === 'default') continue;
        if (uploadCodes.has(code)) continue;
        combined[code] = {
          language_code: code,
          displayName: displayLang.name,
          flag: displayLang.flag || '🏳️',
          originalName: displayLang.originalName || '',
          iso639_3: displayLang.iso639_3 || '',
          canUpload: false,
        };
      }

      setCombinedLanguages(combined);
      const matched = uploadList.length;
      const displayOnly = Object.keys(combined).length - matched;
      debug(`🔗 Combined: ${matched} uploadable + ${displayOnly} display-only`);
    },
    [debug]
  );

  // -------------------------------------------------------------------------
  // Init — fetch both sources in parallel, then combine
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;
    setLanguagesLoading(true);
    setLanguagesError(null);

    Promise.all([loadDisplayLanguages(), loadUploadLanguages()])
      .then(([displayMap, uploadList]) => {
        if (cancelled) return;
        combineLanguageData(displayMap, uploadList);
      })
      .catch(err => {
        if (cancelled) return;
        debug(`❌ Language load failed: ${err.message}`);
        setLanguagesError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLanguagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadDisplayLanguages, loadUploadLanguages, combineLanguageData, debug]);

  // -------------------------------------------------------------------------
  // Per-subtitle language selection (unchanged from previous version)
  // -------------------------------------------------------------------------

  const handleSubtitleLanguageChange = useCallback((subtitlePath, languageCode) => {
    setSubtitleLanguages(prev => ({ ...prev, [subtitlePath]: languageCode }));
  }, []);

  const clearSubtitleLanguages = useCallback(() => {
    setSubtitleLanguages({});
  }, []);

  const getLanguageInfo = useCallback(
    languageCode => {
      if (!languageCode) return { flag: '🏳️', name: 'Unknown' };

      let code;
      if (typeof languageCode === 'object' && languageCode.language_code) {
        code = languageCode.language_code.toLowerCase();
      } else if (typeof languageCode === 'string') {
        code = languageCode.toLowerCase();
      } else {
        return { flag: '🏳️', name: 'Unknown' };
      }

      if (languageMap[code]) return languageMap[code];
      return { flag: '🏳️', name: code.toUpperCase() };
    },
    [languageMap]
  );

  const getSubtitleLanguage = useCallback(
    subtitle => {
      const selected = subtitleLanguages[subtitle.fullPath];
      if (selected) return selected;

      if (
        subtitle.detectedLanguage &&
        typeof subtitle.detectedLanguage === 'object' &&
        subtitle.detectedLanguage.language_code
      ) {
        return subtitle.detectedLanguage.language_code.toLowerCase();
      }
      return '';
    },
    [subtitleLanguages]
  );

  const getLanguageOptionsForSubtitle = useCallback(
    subtitle => {
      const options = [];

      // Detected languages first (if any)
      if (
        subtitle.detectedLanguage &&
        typeof subtitle.detectedLanguage === 'object' &&
        subtitle.detectedLanguage.all_languages
      ) {
        subtitle.detectedLanguage.all_languages
          .sort((a, b) => b.confidence - a.confidence)
          .forEach(lang => {
            const code = lang.language_code.toLowerCase();
            const combinedLang = combinedLanguages[code];
            if (combinedLang && combinedLang.canUpload) {
              options.push({ code, ...combinedLang, confidence: lang.confidence, isDetected: true });
            }
          });
      }

      // Other upload-enabled languages
      const detectedCodes = new Set(options.map(opt => opt.code));
      Object.entries(combinedLanguages)
        .filter(([code, lang]) => lang.canUpload && !detectedCodes.has(code))
        .sort(([, a], [, b]) => a.displayName.localeCompare(b.displayName))
        .forEach(([code, lang]) => {
          options.push({ code, ...lang, isDetected: false });
        });

      return options;
    },
    [combinedLanguages]
  );

  return {
    languageMap,
    uploadLanguages,
    combinedLanguages,
    languagesLoading,
    languagesError,
    subtitleLanguages,
    handleSubtitleLanguageChange,
    clearSubtitleLanguages,
    getLanguageInfo,
    getSubtitleLanguage,
    getLanguageOptionsForSubtitle,
    // Retained for back-compat; consumers can re-trigger if needed
    loadLanguages: loadDisplayLanguages,
  };
};
