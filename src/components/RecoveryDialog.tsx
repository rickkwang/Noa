import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LOCAL_DATA_BOUNDARY_COPY } from '../lib/userFacingCopy';

interface RecoveryDialogProps {
  message: string;
  onRetry: () => void;
  onImportBackup: (file: File) => void;
  onReset: () => void;
}

export default function RecoveryDialog({ message, onRetry, onImportBackup, onReset }: RecoveryDialogProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    retryButtonRef.current?.focus();
  }, [message]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    const focusIsOutsideDialog = !event.currentTarget.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || focusIsOutsideDialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || focusIsOutsideDialog)) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-dialog-title"
      aria-describedby="recovery-dialog-message recovery-dialog-actions"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-full max-w-xl bg-[#F9F9F7] border border-[#2D2D2B] noa-floating-panel p-4 font-redaction space-y-3 slide-down">
        <h3 id="recovery-dialog-title" className="text-sm font-bold tracking-wider uppercase">Recovery Needed</h3>
        <p id="recovery-dialog-message" className="text-sm text-[#2D2D2B]/80">{message}</p>
        <p className="text-xs text-[#2D2D2B]/60">{LOCAL_DATA_BOUNDARY_COPY}</p>
        <p id="recovery-dialog-actions" className="text-xs text-[#2D2D2B]/60">Choose an action: retry loading, import a JSON backup, or reset to a new workspace.</p>
        <div className="flex flex-wrap gap-2">
          <button
            ref={retryButtonRef}
            onClick={onRetry}
            className="px-3 py-1 text-xs font-bold bg-[#F9F9F7] border border-[#2D2D2B] hover:bg-[#EFEAE3]"
          >
            Retry Read
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            className="px-3 py-1 text-xs font-bold bg-[#CC7D5E] text-white border border-[#2D2D2B] hover:opacity-90"
          >
            Import Backup
          </button>
          <button
            onClick={onReset}
            className="px-3 py-1 text-xs font-bold bg-[#D45555]/15 text-[#953333] border border-[#D45555]/60 hover:bg-[#D45555]/30"
          >
            New Empty Workspace
          </button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onImportBackup(file);
            }
            e.currentTarget.value = '';
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
