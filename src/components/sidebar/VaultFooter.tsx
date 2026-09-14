import React, { useEffect, useState } from 'react';
import { SyncStatus } from '../../types';
import { Check, ChevronsUpDown, HardDrive, RefreshCcw, Settings, Unlink } from '@/src/lib/icons';

export interface VaultFooterProps {
  /** Always present: the local IndexedDB workspace this app is showing. */
  workspaceName: string;
  /** Directory name of the connected vault folder, or null when none is attached. */
  vaultName: string | null;
  syncStatus: SyncStatus;
  lastSyncAt?: string | null;
  syncError?: string | null;
  /** True while a connect/disconnect is in flight — actions stay disabled. */
  busy?: boolean;
  /** Absent when the browser has no File System Access API. */
  onConnectVault?: () => void;
  /** Disconnects the current folder, then opens the picker for the next one. */
  onSwitchVault?: () => void;
  onDisconnectVault?: () => void;
  onRetrySync?: () => void;
  onOpenWorkspaceSettings: () => void;
  onOpenSettings: () => void;
}

function syncLabel(status: SyncStatus, lastSyncAt?: string | null): string {
  if (status === 'syncing') return 'Syncing…';
  if (status === 'error') return 'Sync failed';
  if (!lastSyncAt) return status === 'ready' ? 'Synced' : 'Not synced yet';
  const elapsed = Date.now() - new Date(lastSyncAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'Synced';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  return `Synced ${new Date(lastSyncAt).toLocaleDateString()}`;
}

const DOT_CLASS: Record<SyncStatus, string> = {
  idle: 'bg-[var(--text-primary,#2D2D2B)]/30',
  syncing: 'bg-[#D9862B]',
  ready: 'bg-[#6E8B63]',
  error: 'bg-[#C24444]',
};

export function VaultFooter({
  workspaceName,
  vaultName,
  syncStatus,
  lastSyncAt,
  syncError,
  busy = false,
  onConnectVault,
  onSwitchVault,
  onDisconnectVault,
  onRetrySync,
  onOpenWorkspaceSettings,
  onOpenSettings,
}: VaultFooterProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Switching disconnects before it can open the picker, and a cancelled picker
  // leaves no vault attached — so it asks first rather than acting on one click.
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('[data-vault-menu]') && !target.closest('[data-vault-btn]')) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The sidebar's hover preview closes on Escape too (useSidebarPreview), and
      // it listens on window — later in the bubble than this. Without stopping
      // here, one keypress dismisses the menu and collapses the whole sidebar.
      e.stopPropagation();
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  useEffect(() => { if (!isOpen) setConfirmSwitch(false); }, [isOpen]);

  const label = workspaceName.trim() || 'Workspace';
  const status = syncLabel(syncStatus, lastSyncAt);
  const itemClass = 'noa-sidebar-hover-surface flex items-center gap-2 w-full rounded px-2 py-1.5 text-left text-xs font-redaction text-[#2D2D2B] transition-colors disabled:opacity-40 disabled:pointer-events-none';

  const run = (action?: () => void) => {
    setIsOpen(false);
    action?.();
  };

  return (
    <div
      className="noa-sidebar-section-surface relative flex items-center gap-0.5 shrink-0 border-t pl-1.5 pr-1 py-1"
      style={{ borderTopColor: 'var(--panel-divider, #2D2D2B)' }}
    >
      {isOpen && (
        <div
          data-vault-menu
          role="menu"
          className="absolute bottom-full left-1 z-50 mb-1 w-[calc(100%-0.5rem)] min-w-[190px] rounded-md border border-[var(--divider-subtle)] bg-[#F9F9F7] noa-floating-panel p-1 flex flex-col"
        >
          {confirmSwitch ? (
            <div className="px-2 py-1.5 flex flex-col gap-2">
              <p className="text-xs font-redaction text-[#2D2D2B] leading-relaxed">
                Disconnect <span className="font-bold">{vaultName}</span> first, then pick the next folder?
                Its notes and folders leave the workspace and their tabs close — the files on
                disk are untouched. Cancelling the picker leaves you with no vault until you reconnect.
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  role="menuitem"
                  className="flex-1 rounded px-2 py-1 text-xs font-redaction font-bold bg-[#CC7D5E] text-[var(--bg-primary,#FCFCFB)] transition-opacity hover:opacity-90"
                  onClick={() => run(onSwitchVault)}
                >
                  Continue
                </button>
                <button
                  role="menuitem"
                  className="noa-sidebar-hover-surface flex-1 rounded px-2 py-1 text-xs font-redaction text-[#2D2D2B] transition-colors"
                  onClick={() => setConfirmSwitch(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Workspace and vault are separate things that coexist: the
                  workspace is always here, the vault is an optional folder
                  mirrored into it. The menu states both rather than picking one. */}
              <div className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-redaction text-[#2D2D2B]">
                <Check size={13} className="shrink-0 text-[#2D2D2B]/50" />
                <span className="truncate">{label}</span>
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-[#2D2D2B]/50">Workspace</span>
              </div>

              <div className="my-1 h-px bg-[var(--divider-subtle)]" />

              {vaultName ? (
                <>
                  <div className="px-2 pt-0.5 pb-1.5">
                    <div className="flex items-center gap-2 text-xs font-redaction text-[#2D2D2B]">
                      <HardDrive size={13} className="shrink-0 text-[#2D2D2B]/50" />
                      <span className="truncate">{vaultName}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 pl-[21px] text-[10px] font-redaction text-[#2D2D2B]/60">
                      <span className="shrink-0">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full align-middle ${DOT_CLASS[syncStatus]}`} />
                      </span>
                      <span className="truncate">{syncError || status}</span>
                    </div>
                  </div>
                  {syncStatus === 'error' && onRetrySync && (
                    <button role="menuitem" className={itemClass} onClick={() => run(onRetrySync)} disabled={busy}>
                      <RefreshCcw size={13} className="shrink-0 text-[#2D2D2B]/50" />
                      <span>Retry sync</span>
                    </button>
                  )}
                  {onSwitchVault && (
                    <button role="menuitem" className={itemClass} onClick={() => setConfirmSwitch(true)} disabled={busy}>
                      <ChevronsUpDown size={13} className="shrink-0 text-[#2D2D2B]/50" />
                      <span>Switch vault folder…</span>
                    </button>
                  )}
                  {onDisconnectVault && (
                    <button role="menuitem" className={itemClass} onClick={() => run(onDisconnectVault)} disabled={busy}>
                      <Unlink size={13} className="shrink-0 text-[#2D2D2B]/50" />
                      <span>Disconnect vault</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-redaction text-[#2D2D2B]/60">
                    <Unlink size={13} className="shrink-0" />
                    <span className="truncate">No vault connected</span>
                  </div>
                  {onConnectVault && (
                    <button role="menuitem" className={itemClass} onClick={() => run(onConnectVault)} disabled={busy}>
                      <HardDrive size={13} className="shrink-0 text-[#2D2D2B]/50" />
                      <span>Connect vault folder…</span>
                    </button>
                  )}
                </>
              )}

              <div className="my-1 h-px bg-[var(--divider-subtle)]" />

              <button role="menuitem" className={itemClass} onClick={() => run(onOpenWorkspaceSettings)}>
                <Settings size={13} className="shrink-0 text-[#2D2D2B]/50" />
                <span>Workspace settings…</span>
              </button>
            </>
          )}
        </div>
      )}

      <button
        data-vault-btn
        onClick={() => setIsOpen(v => !v)}
        className="noa-sidebar-hover-surface flex items-center min-w-0 rounded-lg pl-1.5 pr-3.5 py-1 text-[11px] font-redaction font-bold text-[#2D2D2B]/70 hover:text-[#2D2D2B] transition-colors cursor-pointer"
        title={vaultName ? `${label} · vault: ${vaultName} (${syncError || status})` : `${label} · no vault connected`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {/* size/margin match the Calendar + Tags Explorer headers above, so all
            three icons land on the same 12px rail. */}
        <ChevronsUpDown size={11} className="mr-1.5 shrink-0" />
        <span className="truncate">{label}</span>
        {/* The dot rides vertical-align:middle inside its own inline context —
            baseline + half x-height, i.e. the optical centre of the lowercase
            text. As a bare flex child it centres on the line box instead, which
            includes descender space the label doesn't use and reads ~1.5px high. */}
        {vaultName && (
          <span className="ml-1.5 shrink-0" aria-hidden>
            <span className={`inline-block h-1.5 w-1.5 rounded-full align-middle ${DOT_CLASS[syncStatus]}`} />
          </span>
        )}
      </button>

      {/* Centred on the same vertical rail as the collapse chevrons above:
          those sit at px-3 with a 10px glyph, so their midline is 17px in from
          the right edge — 4px (pr-1) + 6px (p-1.5) + half of 14px lands there. */}
      <button
        onClick={onOpenSettings}
        className="p-1.5 ml-auto shrink-0 rounded-lg text-[#2D2D2B]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer"
        title="Settings"
        aria-label="Open settings"
      >
        <Settings size={14} />
      </button>
    </div>
  );
}
