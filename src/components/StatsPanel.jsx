import React from 'react';

export const StatsPanel = ({
  pairedFiles,
  files,
  orphanedSubtitles = [],
  getUploadEnabled,
  // eslint-disable-next-line no-unused-vars
  colors,
  // eslint-disable-next-line no-unused-vars
  isDark,
}) => {
  const successfulPairs = pairedFiles.filter(p => p.video && p.subtitles.length > 0);
  const totalVideos = files.filter(f => f.isVideo).length;
  const pairedSubtitles = pairedFiles.flatMap(pair => pair.subtitles || []);
  const allAvailableSubtitles = [...pairedSubtitles, ...orphanedSubtitles];
  const enabledSubtitles = allAvailableSubtitles.filter(subtitle =>
    getUploadEnabled(subtitle.fullPath)
  );
  const disabledSubtitles = allAvailableSubtitles.length - enabledSubtitles.length;

  const cards = [
    {
      label: 'Videos with Subtitles',
      value: successfulPairs.length,
      accent: 'border-l-primary text-primary',
    },
    {
      label: 'Ready to Upload',
      value: enabledSubtitles.length,
      accent: 'border-l-success text-success',
    },
    {
      label: 'Skipped',
      value: disabledSubtitles,
      accent: 'border-l-base-content/30 text-base-content/60',
    },
    {
      label: 'Total Videos',
      value: totalVideos,
      accent: 'border-l-info text-info',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
      {cards.map(card => (
        <div
          key={card.label}
          className={`rounded-md p-4 text-center shadow-sm bg-base-100 border border-base-300 border-l-4 ${card.accent}`}
        >
          <div className="text-2xl font-semibold leading-tight">{card.value}</div>
          <div className="text-sm text-base-content/70 mt-1">{card.label}</div>
        </div>
      ))}
    </div>
  );
};
