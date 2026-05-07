import React from 'react';
import { UploadCloud, Film, FileText, Folder, Archive, FilePlus, FolderPlus } from 'lucide-react';
import { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS, ARCHIVE_EXTENSIONS } from '../utils/constants.js';

export const DropZone = ({
  isDragOver,
  onDrop,
  onDragOver,
  onDragLeave,
  hasFiles,
  onClearFiles,
  onFileSelect,
  onDirectorySelect,
  // eslint-disable-next-line no-unused-vars
  browserCapabilities,
  // eslint-disable-next-line no-unused-vars
  colors,
  // eslint-disable-next-line no-unused-vars
  isDark,
}) => {
  return (
    <div
      className={[
        'relative rounded-xl border-2 border-dashed p-10 mb-6 text-center transition-colors',
        isDragOver
          ? 'border-primary bg-primary/5'
          : 'border-base-300 bg-base-100 hover:border-primary/60 hover:bg-base-200/40',
      ].join(' ')}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
    >
      {hasFiles && (
        <button
          type="button"
          onClick={onClearFiles}
          className="btn btn-sm btn-ghost absolute top-3 right-3"
          title="Clear all files"
        >
          Clear All
        </button>
      )}

      <div className="flex flex-col items-center gap-3">
        <UploadCloud className="size-12 text-primary" strokeWidth={1.5} />
        <h3 className="text-xl font-semibold text-base-content">
          Drop your media files or folders here
        </h3>
        <p className="text-sm text-base-content/60 max-w-xl">
          Supports recursive folder scanning for video files (
          {VIDEO_EXTENSIONS.slice(0, 5).join(', ')}, etc.), subtitle files (
          {SUBTITLE_EXTENSIONS.slice(0, 5).join(', ')}, etc.), and archives (.zip, .rar, .7z, .tar,
          etc. — max 100 MB)
        </p>
        <p className="text-sm font-medium text-primary">
          Drag entire movie folders — automatically finds and pairs video files with subtitles
        </p>

        <div className="mt-4 flex flex-wrap justify-center gap-6 text-base-content/60">
          <div className="flex flex-col items-center gap-1">
            <Film className="size-5" />
            <span className="text-xs">Video Files</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <FileText className="size-5" />
            <span className="text-xs">Subtitles</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Folder className="size-5" />
            <span className="text-xs">Folders</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Archive className="size-5" />
            <span className="text-xs">Archives</span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <input
            type="file"
            id="file-input"
            multiple
            accept={`${VIDEO_EXTENSIONS.join(',')},${SUBTITLE_EXTENSIONS.join(',')},${ARCHIVE_EXTENSIONS.join(',')}`}
            onChange={onFileSelect}
            className="hidden"
          />
          <label
            htmlFor="file-input"
            className="btn btn-primary gap-2"
            title={hasFiles ? 'Add more files to the existing selection' : 'Select files to upload'}
          >
            <FilePlus className="size-4" />
            {hasFiles ? 'Add More Files' : 'Select Files'}
          </label>

          <input
            type="file"
            id="directory-input"
            webkitdirectory="true"
            multiple
            onChange={onDirectorySelect}
            className="hidden"
          />
          <label
            htmlFor="directory-input"
            className="btn btn-primary btn-outline gap-2"
            title={
              hasFiles ? 'Add more folders to the existing selection' : 'Select a folder to upload'
            }
          >
            <FolderPlus className="size-4" />
            {hasFiles ? 'Add More Folders' : 'Select Folder'}
          </label>
        </div>
      </div>
    </div>
  );
};
