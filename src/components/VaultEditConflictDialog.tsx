import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { serializeNoteForVault } from '../lib/fileSystemStorage';
import type { Note } from '../types';

interface Props {
  note: Note;
  diskText: string | null;
  busy: boolean;
  error: string | null;
  onReconnect?: () => Promise<void>;
  onResolve: (keepLocal: boolean) => Promise<void>;
}

export default function VaultEditConflictDialog({ note, diskText, busy, error, onReconnect, onResolve }: Props) {
  const { dialogRef, onKeyDown } = useDialogKeyboard(() => {});
  return (
    <div className="fixed inset-0 z-[100] bg-black/30 flex items-center justify-center p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Choose a file version" tabIndex={-1} onKeyDown={onKeyDown} className="outline-none w-full max-w-2xl bg-[var(--surface-page,#F9F9F7)] noa-floating-panel rounded-dialog p-5 space-y-4 font-ui">
        <h2 className="text-sm font-medium">Writing paused: {note.title}</h2>
        <p className="text-body">This file changed outside Noa. Your edit is kept locally. Choose a version for the original file; no conflict file is created.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><h3 className="text-xs mb-2">Noa edit</h3><pre className="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">{serializeNoteForVault(note)}</pre></div>
          <div><h3 className="text-xs mb-2">Disk version</h3><pre className="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">{diskText ?? 'File deleted outside Noa.'}</pre></div>
        </div>
        <p className="text-xs">Choosing a version replaces the other version. Any pending rename or move is cancelled.</p>
        {error && <p role="alert" className="text-xs text-[var(--text-primary,#2D2D2B)]">{error}</p>}
        <div className="flex justify-end gap-2">
          {onReconnect && <button disabled={busy} onClick={() => { void onReconnect(); }} className="px-3 py-1.5 rounded-lg border border-[var(--divider-subtle)] disabled:opacity-50">Reconnect Folder</button>}
          <button disabled={busy} onClick={() => { void onResolve(false); }} className="px-3 py-1.5 rounded-lg border border-[var(--divider-subtle)] disabled:opacity-50">Keep disk version</button>
          <button disabled={busy} onClick={() => { void onResolve(true); }} className="px-3 py-1.5 rounded-lg bg-[var(--text-primary,#2D2D2B)] text-[var(--bg-primary,#FCFCFB)] disabled:opacity-50">Keep Noa edit</button>
        </div>
      </div>
    </div>
  );
}
