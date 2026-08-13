import { useState, useEffect, useCallback, useRef } from 'react';
import { OpenSubtitlesApiService } from '../services/api/openSubtitlesApi.js';
import { languagesApi } from '../services/api/languages.js';
import { retryAsync } from '../utils/retryUtils.js';

// Both /infos/languages and FastText supported-languages return empty `flag`
// fields, so we provide a fallback mapping from language code to country flag
// emoji. Codes that don't have an obvious country fall through to the
// white-flag default.
const LANGUAGE_FLAGS = {
  af: '🇿🇦',
  sq: '🇦🇱',
  am: '🇪🇹',
  ar: '🇸🇦',
  hy: '🇦🇲',
  as: '🇮🇳',
  az: '🇦🇿',
  be: '🇧🇾',
  bn: '🇧🇩',
  bs: '🇧🇦',
  bg: '🇧🇬',
  my: '🇲🇲',
  zh: '🇨🇳',
  'zh-cn': '🇨🇳',
  'zh-tw': '🇹🇼',
  hr: '🇭🇷',
  cs: '🇨🇿',
  da: '🇩🇰',
  nl: '🇳🇱',
  en: '🇬🇧',
  et: '🇪🇪',
  fi: '🇫🇮',
  fr: '🇫🇷',
  gl: '🇪🇸',
  ka: '🇬🇪',
  de: '🇩🇪',
  el: '🇬🇷',
  he: '🇮🇱',
  hi: '🇮🇳',
  hu: '🇭🇺',
  is: '🇮🇸',
  id: '🇮🇩',
  ga: '🇮🇪',
  it: '🇮🇹',
  ja: '🇯🇵',
  kk: '🇰🇿',
  km: '🇰🇭',
  ko: '🇰🇷',
  ky: '🇰🇬',
  lo: '🇱🇦',
  lv: '🇱🇻',
  lt: '🇱🇹',
  lb: '🇱🇺',
  mk: '🇲🇰',
  ms: '🇲🇾',
  ml: '🇮🇳',
  mt: '🇲🇹',
  mr: '🇮🇳',
  mn: '🇲🇳',
  ne: '🇳🇵',
  no: '🇳🇴',
  nb: '🇳🇴',
  nn: '🇳🇴',
  or: '🇮🇳',
  fa: '🇮🇷',
  pl: '🇵🇱',
  pt: '🇵🇹',
  'pt-br': '🇧🇷',
  'pt-pt': '🇵🇹',
  ps: '🇦🇫',
  pa: '🇮🇳',
  ro: '🇷🇴',
  ru: '🇷🇺',
  sa: '🇮🇳',
  sr: '🇷🇸',
  si: '🇱🇰',
  sk: '🇸🇰',
  sl: '🇸🇮',
  so: '🇸🇴',
  es: '🇪🇸',
  sw: '🇰🇪',
  sv: '🇸🇪',
  tl: '🇵🇭',
  tg: '🇹🇯',
  ta: '🇮🇳',
  tt: '🇷🇺',
  te: '🇮🇳',
  th: '🇹🇭',
  tr: '🇹🇷',
  uk: '🇺🇦',
  ur: '🇵🇰',
  uz: '🇺🇿',
  vi: '🇻🇳',
  cy: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  xh: '🇿🇦',
  yo: '🇳🇬',
  zu: '🇿🇦',
  // 3-letter codes some endpoints return
  eng: '🇬🇧',
  fre: '🇫🇷',
  ger: '🇩🇪',
  spa: '🇪🇸',
  ita: '🇮🇹',
  por: '🇵🇹',
  rus: '🇷🇺',
  jpn: '🇯🇵',
  kor: '🇰🇷',
  chi: '🇨🇳',
  ara: '🇸🇦',
  heb: '🇮🇱',
  tur: '🇹🇷',
  pol: '🇵🇱',
  nld: '🇳🇱',
  dut: '🇳🇱',
  dan: '🇩🇰',
  swe: '🇸🇪',
  nor: '🇳🇴',
  fin: '🇫🇮',
  cze: '🇨🇿',
  ces: '🇨🇿',
  gre: '🇬🇷',
  ell: '🇬🇷',
  hun: '🇭🇺',
  ron: '🇷🇴',
  rum: '🇷🇴',
  slk: '🇸🇰',
  slo: '🇸🇰',
  slv: '🇸🇮',
  bul: '🇧🇬',
  ukr: '🇺🇦',
  srp: '🇷🇸',
  hrv: '🇭🇷',
  bos: '🇧🇦',
  vie: '🇻🇳',
  tha: '🇹🇭',
  ind: '🇮🇩',
  may: '🇲🇾',
  msa: '🇲🇾',
  hin: '🇮🇳',
  ben: '🇧🇩',
  tam: '🇮🇳',
  tel: '🇮🇳',
  mar: '🇮🇳',
  per: '🇮🇷',
  fas: '🇮🇷',
  urd: '🇵🇰',
};

function flagForLangCode(code) {
  if (!code) return '🏳️';
  const lc = String(code).toLowerCase();
  return LANGUAGE_FLAGS[lc] || LANGUAGE_FLAGS[lc.split('-')[0]] || '🏳️';
}

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
  const [languageMap, setLanguageMap] = useState({}); // FastText (display)
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
          flag: displayLang?.flag || flagForLangCode(code),
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
          flag: displayLang.flag || flagForLangCode(code),
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

    // Fire both loaders independently. They each call setLanguageMap /
    // setUploadLanguages on success; a separate useEffect re-combines
    // whenever either piece changes. This means combinedLanguages
    // populates as soon as the FIRST source resolves, even if the other
    // hangs forever (previously a hung /infos/languages froze the whole
    // thing because Promise.allSettled waits for both to settle).
    let resolvedCount = 0;
    const markDone = () => {
      resolvedCount += 1;
      if (resolvedCount >= 2 && !cancelled) setLanguagesLoading(false);
    };
    loadDisplayLanguages()
      .catch(err => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[useLanguageData] FastText load failed:', err);
        debug(`❌ FastText load failed: ${err?.message}`);
      })
      .finally(markDone);
    loadUploadLanguages()
      .catch(err => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[useLanguageData] /infos/languages load failed:', err);
        debug(`❌ /infos/languages load failed: ${err?.message}`);
      })
      .finally(markDone);

    // Stop the spinner after 8s even if a loader never settles. Whatever
    // arrived by then is what the picker will use.
    const spinnerTimeout = setTimeout(() => {
      if (!cancelled) setLanguagesLoading(false);
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(spinnerTimeout);
    };
  }, [loadDisplayLanguages, loadUploadLanguages, debug]);

  // Re-combine whenever EITHER source updates. This is the key change vs
  // the previous Promise.allSettled-then-combine approach: combine no longer
  // depends on both sources resolving.
  useEffect(() => {
    if (Object.keys(languageMap).length === 0 && uploadLanguages.length === 0) return;
    combineLanguageData(languageMap, uploadLanguages);
  }, [languageMap, uploadLanguages, combineLanguageData]);

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

  /**
   * Resolve a raw language code (often from FastText detection — e.g. 2-letter
   * 'en' / 'fr') to whichever code the upload list actually accepts (e.g.
   * 3-letter 'eng' / 'fre'). Cross-references via iso639_3 metadata that
   * combinedLanguages already carries from the FastText supported-languages
   * source, so detection results pre-fill the upload picker correctly even
   * when the two endpoints disagree on code shape.
   */
  const resolveUploadLanguageCode = useCallback(
    rawCode => {
      if (!rawCode) return '';
      const code = String(rawCode).toLowerCase();
      const direct = combinedLanguages[code];
      if (direct?.canUpload) return code;

      // Detected code present but not upload-enabled → look for an
      // upload-enabled entry that shares its iso639_3 (e.g. 'en' → 'eng').
      const iso = direct?.iso639_3;
      if (iso) {
        const lcIso = iso.toLowerCase();
        if (combinedLanguages[lcIso]?.canUpload) return lcIso;
        const match = Object.values(combinedLanguages).find(
          lang => lang.canUpload && lang.iso639_3?.toLowerCase() === lcIso
        );
        if (match?.language_code) return match.language_code;
      }

      // Last-ditch: any upload-enabled lang whose iso639_3 starts with the
      // raw 2-letter code, or whose language_code starts with the raw code.
      const fallback = Object.values(combinedLanguages).find(
        lang =>
          lang.canUpload &&
          (lang.iso639_3?.toLowerCase().startsWith(code) || lang.language_code?.startsWith(code))
      );
      if (fallback?.language_code) return fallback.language_code;

      return code;
    },
    [combinedLanguages]
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
        return resolveUploadLanguageCode(subtitle.detectedLanguage.language_code);
      }
      return '';
    },
    [subtitleLanguages, resolveUploadLanguageCode]
  );

  const getLanguageOptionsForSubtitle = useCallback(
    subtitle => {
      const options = [];

      // Detected languages first (if any) — resolve through the upload-code
      // mapper so 2-letter FastText results ('en') surface as the matching
      // 3-letter upload code ('eng') and the entry is actually pickable.
      if (
        subtitle.detectedLanguage &&
        typeof subtitle.detectedLanguage === 'object' &&
        subtitle.detectedLanguage.all_languages
      ) {
        subtitle.detectedLanguage.all_languages
          .sort((a, b) => b.confidence - a.confidence)
          .forEach(lang => {
            const resolved = resolveUploadLanguageCode(lang.language_code);
            const combinedLang = combinedLanguages[resolved];
            if (combinedLang && combinedLang.canUpload) {
              options.push({
                code: resolved,
                ...combinedLang,
                confidence: lang.confidence,
                isDetected: true,
              });
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
    [combinedLanguages, resolveUploadLanguageCode]
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
