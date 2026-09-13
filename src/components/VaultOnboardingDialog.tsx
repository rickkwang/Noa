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
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Connect a Markdown folder" tabIndex={-1} onKeyDown={onKeyDown} className="outline-none w-full max-w-md border border-[#2D2D2B] bg-[#F9F9F7] noa-floating-panel slide-down">
        <div className="border-b border-[#2D2D2B] px-4 py-3 bg-[#EFEAE3]">
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
            <p className="text-xs text-[#A34A3E] border border-[#A34A3E]/40 bg-[#A34A3E]/10 px-2 py-1">{error}</p>
          )}
        </div>
        <div className="border-t border-[#2D2D2B]/20 px-4 py-2 flex items-center justify-between gap-2">
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
            className="text-xs uppercase tracking-wider font-bold border border-[#2D2D2B]/30 px-2 py-1 text-[#2D2D2B]/80 hover:text-[#2D2D2B] hover:border-[#2D2D2B]/60 disabled:opacity-50"
          >
            {connecting ? 'Connecting…' : 'Connect folder'}
          </button>
        </div>
      </div>
    </div>
  );
}
