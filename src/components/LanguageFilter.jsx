import React, { useMemo } from 'react';

export const LanguageFilter = ({
  files,
  selectedLanguages,
  onLanguageToggle,
  getSubtitleLanguage,
  combinedLanguages,
  // eslint-disable-next-line no-unused-vars
  colors,
  // eslint-disable-next-line no-unused-vars
  isDark,
}) => {
  const languageStats = useMemo(() => {
    const stats = new Map();

    files.forEach(file => {
      if (file.isSubtitle) {
        const langCode = getSubtitleLanguage(file);
        if (!langCode) return;

        const langInfo = combinedLanguages[langCode.toLowerCase()];
        const langName = langInfo?.name || langInfo?.languageName || langCode.toUpperCase();

        if (!stats.has(langCode)) {
          stats.set(langCode, { code: langCode, name: langName, count: 0, files: [] });
        }
        const entry = stats.get(langCode);
        entry.count++;
        entry.files.push(file.fullPath);
      }
    });

    return Array.from(stats.values()).sort((a, b) => b.count - a.count);
  }, [files, getSubtitleLanguage, combinedLanguages]);

  if (languageStats.length === 0) {
    return null;
  }

  const selectAll = () => {
    onLanguageToggle(new Set(languageStats.map(l => l.code)));
  };
  const deselectAll = () => {
    onLanguageToggle(new Set());
  };

  return (
    <div className="rounded-md p-6 mb-6 mt-6 bg-base-100 border border-base-300">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-lg font-semibold text-base-content">Filter by Language</h3>
        <div className="flex gap-2">
          <button type="button" onClick={selectAll} className="btn btn-xs btn-ghost">
            Select All
          </button>
          <button type="button" onClick={deselectAll} className="btn btn-xs btn-ghost">
            Deselect All
          </button>
        </div>
      </div>

      <div className="text-sm text-base-content/70 mb-3">
        Select which languages to upload. Unchecked languages will be skipped.
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {languageStats.map(lang => {
          const isSelected = selectedLanguages.has(lang.code);
          return (
            <label
              key={lang.code}
              className={[
                'flex items-center gap-2 p-3 rounded-md cursor-pointer transition-all border-2',
                isSelected
                  ? 'border-success bg-success/5'
                  : 'border-base-300 bg-base-200/40 opacity-70 hover:opacity-100',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => {
                  const newSelected = new Set(selectedLanguages);
                  if (isSelected) newSelected.delete(lang.code);
                  else newSelected.add(lang.code);
                  onLanguageToggle(newSelected);
                }}
                className="checkbox checkbox-sm checkbox-success"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate text-base-content" title={lang.name}>
                  {lang.name}
                </div>
                <div className="text-xs text-base-content/60">
                  {lang.count} {lang.count === 1 ? 'subtitle' : 'subtitles'}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};
