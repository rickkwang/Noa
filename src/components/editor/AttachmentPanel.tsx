import React, { useRef, useState } from 'react';
import { Attachment } from '../../types';
import { AttachmentError } from '../../hooks/useAttachments';

interface AttachmentPanelProps {
  attachments: Attachment[];
  onUpload: (file: File) => Promise<AttachmentError | null>;
  onDelete: (attachmentId: string) => void | Promise<void>;
  onInsertReference: (filename: string, mimeType: string) => void;
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

export function AttachmentPanel({ attachments, onUpload, onDelete, onInsertReference }: AttachmentPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
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
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  };

  return (
    <div
      className={`border-t border-[#2D2D2D]/10 bg-[#EAE8E0] shrink-0 transition-colors ${isDragOver ? 'bg-[#B89B5E]/10' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-1.5">
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#2D2D2D]/50 hover:text-[#2D2D2D] transition-colors active:opacity-70"
          title={isOpen ? 'Collapse Attachments' : 'Expand Attachments'}
        >
          <span>{isOpen ? '▾' : '▸'}</span>
          <span>Attachments</span>
          {attachments.length > 0 && (
            <span className="ml-0.5 text-[#B89B5E]">({attachments.length})</span>
          )}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="ml-auto text-[10px] uppercase tracking-widest text-[#2D2D2D]/40 hover:text-[#B89B5E] transition-colors active:opacity-70"
          title="Add Attachment"
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
        <div className="mx-4 mb-2 px-3 py-1.5 bg-red-50 border border-red-300 text-red-700 text-xs font-redaction flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100 active:opacity-70">✕</button>
        </div>
      )}

      {/* Attachment list */}
      {isOpen && (
        <div className="px-4 pb-2 space-y-0.5">
          {attachments.length === 0 ? (
            <div className="text-[11px] text-[#2D2D2D]/30 font-redaction py-1">
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
                  onClick={() => onInsertReference(att.filename, att.mimeType)}
                  className="flex-1 text-left text-xs font-redaction text-[#2D2D2D]/70 hover:text-[#B89B5E] truncate transition-colors active:opacity-70"
                  title={`Insert reference: ${att.filename}`}
                >
                  {att.filename}
                </button>
                <span className="text-[10px] text-[#2D2D2D]/30 shrink-0">{formatBytes(att.size)}</span>
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
                      disabled={deletingId === att.id}
                      className="text-[10px] text-red-500 hover:text-red-700 active:opacity-70"
                    >
                      {deletingId === att.id ? '…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-[10px] text-[#2D2D2D]/40 hover:text-[#2D2D2D] active:opacity-70"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(att.id)}
                    className="text-[10px] text-[#2D2D2D]/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all active:opacity-70 shrink-0"
                    title="Delete Attachment"
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
