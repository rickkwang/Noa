import React, { useRef, useState } from 'react';
import { AttachmentError } from '../../hooks/useAttachments';
import { Attachment } from '../../types';

interface AttachmentPanelProps {
  attachments: Attachment[];
  onUpload: (file: File) => Promise<AttachmentError | null>;
  onDelete: (attachmentId: string) => void | Promise<void>;
  onInsertReference: (filename: string, mimeType: string) => void;
  readOnly?: boolean;
  mutationsDisabled?: boolean;
  mutationsDisabledReason?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼';
  return '📎';
}

const ERROR_MESSAGES: Record<AttachmentError, string> = {
  type_not_allowed: 'Unsupported file type (images only)',
  size_exceeded: 'File exceeds 10MB limit',
  storage_full: 'Storage is almost full, please free up space',
  upload_failed: 'Upload failed, please try again',
};

export function AttachmentPanel({
  attachments,
  onUpload,
  onDelete,
  onInsertReference,
  readOnly = false,
  mutationsDisabled = false,
  mutationsDisabledReason,
}: AttachmentPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    if (readOnly || mutationsDisabled) return;
    setError(null);
    for (const file of Array.from(files)) {
      const err = await onUpload(file);
      if (err) {
        setError(ERROR_MESSAGES[err]);
        return;
      }
    }
    setIsOpen(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (readOnly || mutationsDisabled) return;
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (readOnly || mutationsDisabled) return;
    setIsDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  };

  // No attachments: show a minimal drag target, no visible bar
  if (attachments.length === 0 && !isDragOver) {
    return (
      <div
        className="group bg-[#F9F9F7] shrink-0"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center px-4 opacity-0 group-hover:opacity-100 transition-opacity h-0 group-hover:h-auto overflow-hidden">
          <button
            disabled={readOnly || mutationsDisabled}
            onClick={() => fileInputRef.current?.click()}
            className="text-[10px] uppercase tracking-widest text-[#2D2D2B]/40 hover:text-[#CC7D5E] transition-colors active:opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
            title={mutationsDisabledReason ?? 'Add Attachment'}
          >
            + Attachments
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInput} />
        </div>
        {error && (
          <div className="mx-4 mb-2 px-3 py-1.5 bg-[#D45555]/10 border border-[#D45555]/40 text-[#A93B3B] text-xs font-redaction flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100 active:opacity-70">✕</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`bg-[#F9F9F7] shrink-0 transition-colors ${isDragOver ? 'bg-[#CC7D5E]/10' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-1.5">
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#2D2D2B]/50 hover:text-[#2D2D2B] transition-colors active:opacity-70"
          title={isOpen ? 'Collapse Attachments' : 'Expand Attachments'}
        >
          <span>{isOpen ? '▾' : '▸'}</span>
          <span>Attachments</span>
          <span className="ml-0.5 text-[#CC7D5E]">({attachments.length})</span>
        </button>
        <button
          disabled={readOnly || mutationsDisabled}
          onClick={() => fileInputRef.current?.click()}
          className="ml-auto text-[10px] uppercase tracking-widest text-[#2D2D2B]/40 hover:text-[#CC7D5E] transition-colors active:opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
          title={mutationsDisabledReason ?? 'Add Attachment'}
        >
          + Add
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-1.5 bg-[#D45555]/10 border border-[#D45555]/40 text-[#A93B3B] text-xs font-redaction flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100 active:opacity-70">✕</button>
        </div>
      )}

      {mutationsDisabled && mutationsDisabledReason && (
        <p className="px-4 pb-1 text-[10px] text-[#2D2D2B]/50 font-redaction">
          {mutationsDisabledReason}
        </p>
      )}

      {/* Attachment list */}
      {isOpen && (
        <div className="px-4 pb-2 space-y-0.5">
          {attachments.length === 0 ? (
            <div className="text-xs text-[#2D2D2B]/30 font-redaction py-1">
              Drag files here, or click "+ Add" to upload images.
            </div>
          ) : (
            attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 py-1 group"
              >
                <span className="text-base leading-none shrink-0">{fileIcon(att.mimeType)}</span>
                  <button
                  disabled={readOnly}
                  onClick={() => onInsertReference(att.filename, att.mimeType)}
                  className="flex-1 text-left text-xs font-redaction text-[#2D2D2B]/70 hover:text-[#CC7D5E] truncate transition-colors active:opacity-70 disabled:hover:text-[#2D2D2B]/70 disabled:cursor-default"
                  title={`Insert reference: ${att.filename}`}
                >
                  {att.filename}
                </button>
                <span className="text-[10px] text-[#2D2D2B]/30 shrink-0">{formatBytes(att.size)}</span>
                {confirmDeleteId === att.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={async () => {
                        setDeletingId(att.id);
                        setConfirmDeleteId(null);
                        try {
                          await onDelete(att.id);
                        } catch {
                          setError('Delete failed, please try again');
                        } finally {
                          setDeletingId(null);
                        }
                      }}
                      disabled={deletingId === att.id || mutationsDisabled || readOnly}
                      className="text-[10px] text-[#D45555] hover:text-[#A93B3B] active:opacity-70"
                    >
                      {deletingId === att.id ? '…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-[10px] text-[#2D2D2B]/40 hover:text-[#2D2D2B] active:opacity-70"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    disabled={readOnly || mutationsDisabled}
                    onClick={() => setConfirmDeleteId(att.id)}
                    className="text-[10px] text-[#2D2D2B]/20 hover:text-[#D45555] opacity-0 group-hover:opacity-100 transition-[color,opacity] active:opacity-70 shrink-0 disabled:opacity-0 disabled:cursor-not-allowed"
                    title={mutationsDisabledReason ?? 'Delete Attachment'}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
