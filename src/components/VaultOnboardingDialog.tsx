import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { FolderOpen } from '@/src/lib/icons';
interface VaultOnboardingDialogProps {
  connecting: boolean;
  error: string | null;
  onConnect: () => void;
  onDismiss: () => void;
}

// One quiet surface: no tinted header band, no rules between sections, no
// all-caps. The title carries the question, the body says what connecting
// does, and the one primary action is the only filled control.
export default function VaultOnboardingDialog({ connecting, error, onConnect, onDismiss }: VaultOnboardingDialogProps) {
  const { dialogRef, onKeyDown } = useDialogKeyboard(() => { if (!connecting) onDismiss(); });
  return (
    <div className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center px-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Connect a Markdown folder" tabIndex={-1} onKeyDown={onKeyDown} className="outline-none w-full max-w-sm bg-[var(--surface-page,#F9F9F7)] noa-floating-panel slide-down rounded-dialog overflow-hidden font-ui">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_6%,transparent)] text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_70%,transparent)]">
              <FolderOpen size={15} />
            </span>
            <h2 className="text-[15px] font-medium text-[var(--text-primary,#2D2D2B)]">Connect a Markdown folder</h2>
          </div>
          <div className="mt-3 space-y-2 text-body leading-relaxed text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_70%,transparent)]">
            <p>Open existing Markdown files and save edits back to that folder.</p>
            <p>The connected folder becomes your workspace: edits and new notes are written to it. Noa's local notes are hidden, not deleted, until you disconnect. Back up this folder separately; Noa exports only its local notes.</p>
          </div>
          {error && (
            <p className="mt-3 text-xs text-[#A93B3B] bg-[#D45555]/10 rounded-md px-2.5 py-1.5">{error}</p>
          )}
        </div>
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button
            onClick={onDismiss}
            disabled={connecting}
            className="h-8 rounded-lg px-3 text-body text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_60%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)] transition-colors disabled:opacity-50"
          >
            Continue without a folder
          </button>
          {/* Token pair, not literals: bg-[#2D2D2B] is not remapped in dark
              mode and would vanish into the dark surface. */}
          <button
            onClick={onConnect}
            disabled={connecting}
            className="h-8 rounded-lg px-3.5 text-body font-medium bg-[var(--text-primary,#2D2D2B)] text-[var(--bg-primary,#FCFCFB)] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {connecting ? 'Connecting…' : 'Connect folder'}
          </button>
        </div>
      </div>
    </div>
  );
}
