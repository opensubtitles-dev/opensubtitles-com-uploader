import React from 'react';
import {
  Loader2,
  FolderSearch,
  Film,
  FileText,
  Languages,
  X,
  Check,
  AlertTriangle,
  SkipForward,
} from 'lucide-react';

const ProgressOverlay = ({
  isVisible,
  onCancel,
  progress,
  startTime,
  // eslint-disable-next-line no-unused-vars
  colors,
  // eslint-disable-next-line no-unused-vars
  isDark,
}) => {
  if (!isVisible) return null;

  const timeElapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const minutes = Math.floor(timeElapsed / 60);
  const seconds = timeElapsed % 60;
  const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  const totalFiles = progress.totalFiles || 0;
  const processedFiles = progress.processedFiles || 0;
  const overallProgress = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;

  const stages = [
    {
      name: 'File Discovery',
      Icon: FolderSearch,
      progress: progress.fileDiscovery || 0,
      total: progress.fileDiscoveryTotal || 0,
      progressClass: 'progress-success',
      description: `${progress.totalFiles || 0} files from ${progress.directoriesProcessed || 0} directories`,
    },
    {
      name: 'Video Processing',
      Icon: Film,
      progress: progress.videoProcessing || 0,
      total: progress.videoProcessingTotal || 0,
      progressClass: 'progress-info',
      description: `${progress.videoProcessing || 0} / ${progress.videoProcessingTotal || 0} videos`,
    },
    {
      name: 'Subtitle Processing',
      Icon: FileText,
      progress: progress.subtitleProcessing || 0,
      total: progress.subtitleProcessingTotal || 0,
      progressClass: 'progress-warning',
      description: `${progress.subtitleProcessing || 0} / ${progress.subtitleProcessingTotal || 0} subtitles`,
    },
    {
      name: 'Language Detection',
      Icon: Languages,
      progress: progress.languageDetection || 0,
      total: progress.languageDetectionTotal || 0,
      progressClass: 'progress-primary',
      description: `${progress.languageDetection || 0} / ${progress.languageDetectionTotal || 0} detections`,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-box w-full max-w-3xl bg-base-100 max-h-[85vh] overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 text-primary animate-spin" />
            <h2 className="text-lg font-semibold text-base-content">Processing Files…</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-sm btn-error gap-2"
            title="Cancel processing"
          >
            <X className="size-4" />
            Cancel
          </button>
        </div>

        {/* Overall Progress */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-sm font-medium text-base-content">Overall Progress</span>
            <span className="text-sm font-semibold text-primary">{overallProgress}%</span>
          </div>
          <progress
            className="progress progress-primary w-full"
            value={overallProgress}
            max="100"
          />
          <div className="flex justify-between items-center mt-1.5 text-xs text-base-content/60">
            <span>
              {processedFiles} of {totalFiles} files processed
            </span>
            <span>{timeString} elapsed</span>
          </div>
        </div>

        {/* Stage Progress */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stages.map(stage => {
            const stageProgress =
              stage.total > 0 ? Math.round((stage.progress / stage.total) * 100) : 0;
            const isActive = stage.progress > 0 && stage.progress < stage.total;
            const isComplete = stage.progress >= stage.total && stage.total > 0;
            const StageIcon = stage.Icon;

            return (
              <div key={stage.name} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-base-content">
                    <StageIcon className="size-4" />
                    <span className="text-sm font-medium">{stage.name}</span>
                  </div>
                  <span className="text-xs font-semibold text-base-content/80">
                    {stageProgress}%
                  </span>
                </div>
                <progress
                  className={`progress ${stage.progressClass} w-full h-1.5`}
                  value={stageProgress}
                  max="100"
                />
                <div className="flex justify-between items-center text-xs text-base-content/60">
                  <span>{stage.description}</span>
                  {isComplete && (
                    <span className="flex items-center gap-1 text-success">
                      <Check className="size-3" />
                      Complete
                    </span>
                  )}
                  {isActive && <span className="text-primary animate-pulse">● Processing…</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Error/Skip Summary */}
        {(progress.errors > 0 || progress.skipped > 0) && (
          <div className="mt-5 p-3 rounded-md bg-base-200 border border-base-300 text-sm">
            <div className="flex items-center gap-4">
              {progress.errors > 0 && (
                <span className="flex items-center gap-1 text-error">
                  <AlertTriangle className="size-4" />
                  {progress.errors} errors
                </span>
              )}
              {progress.skipped > 0 && (
                <span className="flex items-center gap-1 text-warning">
                  <SkipForward className="size-4" />
                  {progress.skipped} skipped
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProgressOverlay;
