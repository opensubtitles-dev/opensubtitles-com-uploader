import React from 'react';
import { HelpCircle, X } from 'lucide-react';
import { APP_VERSION } from '../utils/constants.js';

export const HelpOverlay = ({
  isOpen,
  onClose,
  // eslint-disable-next-line no-unused-vars
  colors,
  // eslint-disable-next-line no-unused-vars
  isDark,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="modal-box bg-base-100 w-[90vw] max-w-[800px] max-h-[90vh] p-0 overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-base-300">
          <div className="flex items-center gap-3">
            <HelpCircle className="size-6 text-primary" />
            <div>
              <h2 className="text-xl font-semibold text-base-content">Help & Features</h2>
              <p className="text-sm text-base-content/60">OpenSubtitles Uploader v{APP_VERSION}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm btn-ghost btn-square"
            title="Close help"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1">
          <div className="p-6 space-y-6">
            {/* Quick Start */}
            <section>
              <h3
                className="text-lg font-semibold mb-3 flex items-center gap-2"
                style={{ color: colors.text }}
              >
                🚀 <span>Quick Start</span>
              </h3>
              <div className="space-y-2 text-sm" style={{ color: colors.textSecondary }}>
                <div className="flex gap-3">
                  <span className="font-semibold min-w-[20px]">1.</span>
                  <span>
                    <strong>Drop Files</strong> - Drag video and subtitle files (or entire
                    directories) into the interface
                  </span>
                </div>
                <div className="flex gap-3">
                  <span className="font-semibold min-w-[20px]">2.</span>
                  <span>
                    <strong>Auto-Processing</strong> - The app automatically pairs files, detects
                    languages, and extracts metadata
                  </span>
                </div>
                <div className="flex gap-3">
                  <span className="font-semibold min-w-[20px]">3.</span>
                  <span>
                    <strong>Review</strong> - Check detected information and adjust upload options
                    as needed
                  </span>
                </div>
                <div className="flex gap-3">
                  <span className="font-semibold min-w-[20px]">4.</span>
                  <span>
                    <strong>Upload</strong> - Select subtitles and upload to OpenSubtitles.org
                  </span>
                </div>
              </div>
            </section>

            {/* Core Features */}
            <section>
              <h3
                className="text-lg font-semibold mb-3 flex items-center gap-2"
                style={{ color: colors.text }}
              >
                ⭐ <span>Core Features</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-base">🎬</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Drag & Drop Interface
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Drop video and subtitle files, folders, or archives (.zip, .rar, .7z, .tar,
                      etc.) directly into the browser
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">🔍</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Automatic File Pairing
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Smart matching based on filename similarity
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">🌍</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Language Detection
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      AI-powered subtitle language identification
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">🎯</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Movie Recognition
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Intelligent movie/episode detection with IMDb
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Advanced Features */}
            <section>
              <h3
                className="text-lg font-semibold mb-3 flex items-center gap-2"
                style={{ color: colors.text }}
              >
                🔬 <span>Advanced Features</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-base">📹</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Video Metadata
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Extracts resolution, codec, bitrate, duration
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">🎭</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Episode Detection
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Smart TV show episode identification
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">🔗</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Movie Hash
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Generates OpenSubtitles-compatible hashes
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">🏷️</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Auto Tagging
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Detects HD, HI, foreign parts from filenames
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">📊</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Subtitle Statistics
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Shows existing subtitle counts per movie
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">🖼️</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Movie Posters
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Automatically fetches and displays posters
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">📦</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Archive Support
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Extracts and processes video/subtitle files from various archive formats (max
                      100MB)
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">📁</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      File Selection Button
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Click to browse and select files as an alternative to drag & drop
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">🎞️</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      MKV Subtitle Extraction
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Automatically extracts embedded subtitles from MKV files using FFmpeg
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">📋</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Embedded Changelog
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Click version number to view embedded changelog (no internet required)
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-base">🔄</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Desktop Auto-Updater
                    </div>
                    <div style={{ color: colors.textSecondary }}>
                      Automatic update detection with progress bars and reveal in file manager
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Upload Options */}
            <section>
              <h3
                className="text-lg font-semibold mb-3 flex items-center gap-2"
                style={{ color: colors.text }}
              >
                ⚙️ <span>Upload Options</span>
              </h3>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="flex items-center gap-2">
                    <span>🦻</span>
                    <span style={{ color: colors.text }}>Hearing Impaired</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>📺</span>
                    <span style={{ color: colors.text }}>High Definition</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>🤖</span>
                    <span style={{ color: colors.text }}>Auto Translation</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>🎭</span>
                    <span style={{ color: colors.text }}>Foreign Parts Only</span>
                  </div>
                </div>
                <div
                  className="p-3 rounded-lg"
                  style={{
                    backgroundColor: isDark ? '#2a2a2a' : '#f8f9fa',
                    borderColor: colors.border,
                  }}
                >
                  <div style={{ color: colors.textSecondary }}>
                    <strong>Automatic Detection:</strong> Upload options are automatically detected
                    from filenames and video metadata. You can manually override any detected
                    settings using the Upload Options panel.
                  </div>
                </div>
              </div>
            </section>

            {/* Supported Formats */}
            <section>
              <h3
                className="text-lg font-semibold mb-3 flex items-center gap-2"
                style={{ color: colors.text }}
              >
                📁 <span>Supported Formats</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="font-semibold mb-2" style={{ color: colors.text }}>
                    Video Files
                  </div>
                  <div style={{ color: colors.textSecondary }}>
                    .mp4, .mkv, .avi, .mov, .webm, .flv, .wmv, .mpeg, .ts, .m2ts, and more
                  </div>
                </div>
                <div>
                  <div className="font-semibold mb-2" style={{ color: colors.text }}>
                    Subtitle Files
                  </div>
                  <div style={{ color: colors.textSecondary }}>
                    .srt, .vtt, .ass, .ssa, .sub, .txt, .smi, .mpl, .tmp
                  </div>
                </div>
                <div>
                  <div className="font-semibold mb-2" style={{ color: colors.text }}>
                    Archive Files
                  </div>
                  <div style={{ color: colors.textSecondary }}>
                    .zip, .rar, .7z, .tar.gz, .tar.bz2, .tar.xz, .lha, .cab, .iso, .cpio, .gz, .bz2,
                    .xz, .lz4, .zst files containing video and subtitle files (max 100MB)
                  </div>
                </div>
                <div>
                  <div className="font-semibold mb-2" style={{ color: colors.text }}>
                    Folder Support
                  </div>
                  <div style={{ color: colors.textSecondary }}>
                    Entire directories with nested subdirectories
                  </div>
                </div>
              </div>
            </section>

            {/* Tips */}
            <section>
              <h3
                className="text-lg font-semibold mb-3 flex items-center gap-2"
                style={{ color: colors.text }}
              >
                💡 <span>Pro Tips</span>
              </h3>
              <div className="space-y-2 text-sm" style={{ color: colors.textSecondary }}>
                <div className="flex gap-3">
                  <span>•</span>
                  <span>Drop entire folders to process multiple files at once</span>
                </div>
                <div className="flex gap-3">
                  <span>•</span>
                  <span>
                    Keep video and subtitle files in the same directory for better pairing
                  </span>
                </div>
                <div className="flex gap-3">
                  <span>•</span>
                  <span>Use descriptive filenames - they help with movie detection</span>
                </div>
                <div className="flex gap-3">
                  <span>•</span>
                  <span>
                    Archive files (.zip, .rar, .7z, .tar, etc.) are automatically extracted and
                    processed for media files
                  </span>
                </div>
                <div className="flex gap-3">
                  <span>•</span>
                  <span>Use the file selection button if drag & drop isn't working</span>
                </div>
                <div className="flex gap-3">
                  <span>•</span>
                  <span>Check the preview before uploading to verify subtitle content</span>
                </div>
                <div className="flex gap-3">
                  <span>•</span>
                  <span>The app remembers your theme preference and other settings</span>
                </div>
              </div>
            </section>

            {/* Support */}
            <section>
              <h3
                className="text-lg font-semibold mb-3 flex items-center gap-2"
                style={{ color: colors.text }}
              >
                🆘 <span>Support</span>
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <span>🐛</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Issues & Feedback
                    </div>
                    <a
                      href="https://github.com/opensubtitles/opensubtitles-uploader-pro/issues"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      style={{ color: colors.link }}
                    >
                      GitHub Issues
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span>📖</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Documentation
                    </div>
                    <a
                      href="https://api.opensubtitles.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      style={{ color: colors.link }}
                    >
                      OpenSubtitles API Docs
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span>🌐</span>
                  <div>
                    <div className="font-semibold" style={{ color: colors.text }}>
                      Website
                    </div>
                    <a
                      href="https://www.opensubtitles.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      style={{ color: colors.link }}
                    >
                      opensubtitles.com
                    </a>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex justify-center" style={{ borderColor: colors.border }}>
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg font-medium transition-all hover:opacity-80"
            style={{
              backgroundColor: colors.link,
              color: 'white',
            }}
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};
