import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
interface VaultOnboardingDialogProps {
  connecting: boolean;
  error: string | null;
  onConnect: () => void;
  onDismiss: () => void;
}

export default function VaultOnboardingDialog({ connecting, error, onConnect, onDismiss }: VaultOnboardingDialogProps) {
  const { dialogRef, onKeyDown } = useDialogKeyboard(() => { if (!connecting) onDismiss(); });
  return (
    <div className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center px-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Connect a Markdown folder" tabIndex={-1} onKeyDown={onKeyDown} className="outline-none w-full max-w-md border border-[var(--divider-subtle)] bg-[#F9F9F7] noa-floating-panel slide-down rounded-[14px] overflow-hidden">
        <div className="border-b border-[var(--divider-subtle)] px-4 py-3 bg-[#EFEAE3]">
          <div className="text-xs uppercase tracking-wider text-[#2D2D2B]/60 font-bold">Folder connection</div>
          <div className="text-sm text-[#2D2D2B] mt-1 font-bold">Connect a Markdown folder</div>
        </div>
        <div className="px-4 py-3 space-y-2 text-sm text-[#2D2D2B]/80">
          <p>
            Open existing Markdown files and save edits back to that folder.
          </p>
          <p>
            New notes created in Noa stay in this app, not in the connected folder. Export a backup to keep a separate copy.
          </p>
          {error && (
            <p className="text-xs text-[#A93B3B] border border-[#D45555]/60 bg-[#D45555]/10 rounded-[3px] px-2 py-1">{error}</p>
          )}
        </div>
        <div className="border-t border-[var(--divider-subtle)] px-4 py-2 flex items-center justify-between gap-2">
          <button
            onClick={onDismiss}
            disabled={connecting}
            className="text-xs uppercase tracking-wider font-bold text-[#2D2D2B]/60 hover:text-[#2D2D2B] px-2 py-1 disabled:opacity-50"
          >
            Continue without a folder
          </button>
          <button
            onClick={onConnect}
            disabled={connecting}
            className="text-xs uppercase tracking-wider font-bold border border-[var(--divider-subtle)] rounded-[3px] px-2 py-1 text-[#2D2D2B]/80 hover:text-[#2D2D2B] hover:bg-[#EFEAE3] disabled:opacity-50"
          >
            {connecting ? 'Connecting…' : 'Connect folder'}
          </button>
        </div>
      </div>
    </div>
  );
}
