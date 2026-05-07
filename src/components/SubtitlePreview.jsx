import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export const SubtitlePreview = ({
  subtitle,
  content,
  onClose,
  // eslint-disable-next-line no-unused-vars
  colors,
  // eslint-disable-next-line no-unused-vars
  isDark,
}) => {
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-box w-full max-w-4xl max-h-[80vh] flex flex-col bg-base-100 p-6">
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-base-300">
          <h3 className="text-lg font-semibold text-base-content truncate pr-2">
            Subtitle Preview: {subtitle.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm btn-ghost btn-square"
            title="Close (Esc)"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden min-h-[400px]">
          <div className="p-4 rounded-md text-sm font-mono h-full overflow-y-auto bg-base-200 border border-base-300 text-base-content max-h-[500px]">
            <pre className="whitespace-pre-wrap m-0">{content || 'Loading subtitle content…'}</pre>
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
