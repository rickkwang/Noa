import React, { useEffect, useMemo, useRef, useState } from 'react';
import fable5VerifiedBadge from '../../assets/fable5-verified.png';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { UseAutoBackupResult } from '../../hooks/useAutoBackup';
import { buildDiagnostics, downloadDiagnostics } from '../../lib/diagnostics';
import { lsGet, lsSet } from '../../lib/safeLocalStorage';
import { Note, Folder, AppSettings, SyncStatus } from '../../types';
import AppearanceSettings from './sections/AppearanceSettings';
import AppUpdateSettings from './sections/AppUpdateSettings';
import DataSettings from './sections/DataSettings';
import WritingSettings from './sections/WritingSettings';
import SettingSection from './SettingSection';
import { SettingsIndexEntry, settingAnchorId } from './settingsIndex';
import SettingsSidebar, { SETTINGS_TABS, SettingsTab } from './SettingsSidebar';
import { X } from '@/src/lib/icons';

interface SettingsModalProps {
  onClose: () => void;
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  editorViewMode: 'edit' | 'preview' | 'split';
  setEditorViewMode: (mode: 'edit' | 'preview' | 'split') => void;
  notes: Note[];
  folders: Folder[];
  workspaceName: string;
  onRenameWorkspace: (name: string) => void;
  onImportData: (notes: Note[], folders?: Folder[], workspaceName?: string, shouldPrune?: boolean) => Promise<void>;
  fsHandle: FileSystemDirectoryHandle | null;
  onConnectFs: () => Promise<void>;
  onDisconnectFs: () => Promise<void>;
  fsLastSyncAt?: string | null;
  fsSyncError?: string | null;
  syncStatus: SyncStatus;
  onRetryFsSync?: () => void;
  autoBackup: UseAutoBackupResult;
}

export default function SettingsModal({
  onClose,
  settings,
  updateSettings,
  editorViewMode,
  setEditorViewMode,
  notes,
  folders,
  workspaceName,
  onRenameWorkspace,
  onImportData,
  fsHandle,
  onConnectFs,
  onDisconnectFs,
  fsLastSyncAt,
  fsSyncError,
  syncStatus,
  onRetryFsSync,
  autoBackup,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const saved = lsGet(STORAGE_KEYS.SETTINGS_ACTIVE_TAB);
    // Tabs have been reorganized twice: Data first split into Workspace +
    // Backup & Import with App Update folded into About, then Editor split into
    // General + Notes and Backup & Import renamed to Data. A saved tab from
    // either era still lands somewhere sensible.
    const legacyMap: Record<string, SettingsTab> = {
      data: 'workspace',
      updates: 'about',
      editor: 'general',
      backup: 'data',
    };
    const mapped = saved ? (legacyMap[saved] ?? saved) : null;
    const validTabs = SETTINGS_TABS.map((tab) => tab.id);
    return mapped && validTabs.includes(mapped as SettingsTab) ? (mapped as SettingsTab) : 'general';
  });
  const [mounted, setMounted] = useState(false);
  const [diagnosticsState, setDiagnosticsState] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle');
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMounted(true); }, []);

  // The scrim's backdrop-filter samples the composited frame behind it. With
  // the translucent sidebar that frame is transparent over the sidebar column,
  // so flag the open dialog and let index.css lay an opaque floor back down
  // for as long as it is up — blurring alpha there haloes every glyph.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.settingsOpen = 'true';
    return () => { delete root.dataset.settingsOpen; };
  }, []);

  // Move focus into the dialog on open and return it to the trigger on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  // Keep Tab cycling inside the dialog while it is open.
  const handleFocusTrap = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    lsSet(STORAGE_KEYS.SETTINGS_ACTIVE_TAB, activeTab);
  }, [activeTab]);

  // A search result names a setting on some tab; switching tabs unmounts the
  // current panel, so the scroll has to wait for the target to exist. The flash
  // is what tells the eye which row answered the search — landing silently in
  // the middle of a long tab leaves the person hunting again.
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  const revealSetting = (entry: SettingsIndexEntry) => {
    setActiveTab(entry.tab);
    setPendingReveal(settingAnchorId(entry.label));
  };

  // The timer is held in a ref, not returned as this effect's cleanup: clearing
  // pendingReveal re-runs the effect, and a cleanup would cancel the timer that
  // the same pass just started — leaving data-setting-revealed stuck on the row,
  // so the animation never replayed on a second visit.
  const revealTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!pendingReveal) return;
    const node = document.getElementById(pendingReveal);
    setPendingReveal(null);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.dataset.settingRevealed = 'true';
    window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = window.setTimeout(() => { delete node.dataset.settingRevealed; }, 1200);
  }, [pendingReveal, activeTab]);

  useEffect(() => () => window.clearTimeout(revealTimerRef.current), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape inside a text field or select belongs to the control, not the
      // dialog: editable fields (template form, workspace name) cancel their
      // own draft and a select closes its dropdown — closing the dialog here
      // would drop unsaved edits. Radio/checkbox/range inputs hold no draft,
      // so Escape there still closes. type="search" is in that group too: the
      // sidebar's filter swallows Escape itself while it has a query and stops
      // the event there, so anything reaching us came from an empty field and
      // holds nothing worth keeping.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (tag === 'INPUT') {
        const type = (el as HTMLInputElement).type;
        if (!['radio', 'checkbox', 'range', 'button', 'submit', 'file', 'color', 'search'].includes(type)) return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [onClose]);

  const feedbackUrl = useMemo(() => {
    const appVersion = import.meta.env.PACKAGE_VERSION || 'unknown';
    const lines = [
      'Reporter:',
      '- Name:',
      `- Browser: ${navigator.userAgent}`,
      `- OS/Platform: ${navigator.platform ?? 'unknown'}`,
      `- Language: ${navigator.language ?? 'unknown'}`,
      `- App version: ${appVersion}`,
      '',
      'What happened:',
      '- Summary:',
      '- Reproduction steps:',
      '1.',
      '2.',
      '3.',
      '',
      'Impact:',
      '- Data loss involved? (yes/no)',
      '- Can continue working? (yes/no)',
      '- Workaround available? (yes/no)',
      '- Workaround details:',
      '',
      'Evidence:',
      '- Screenshot/video:',
      '- Console error (if any):',
    ];
    const title = `Noa Feedback (${appVersion})`;
    const body = lines.join('\n');
    return `https://github.com/rickkwang/Noa/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }, []);

  const handleExportDiagnostics = async () => {
    setDiagnosticsState('exporting');
    try {
      const appVersion = import.meta.env.PACKAGE_VERSION || 'unknown';
      const payload = await buildDiagnostics({
        appVersion,
        fileSync: {
          status: syncStatus,
          lastSyncAt: fsLastSyncAt ?? null,
          error: fsSyncError ?? null,
          handleName: fsHandle?.name ?? null,
        },
      });
      downloadDiagnostics(payload);
      setDiagnosticsState('success');
    } catch {
      setDiagnosticsState('error');
    }
  };

  return (
    <div
      data-settings-backdrop="true"
      className="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm p-4 transition-opacity duration-150"
      style={{ backgroundColor: mounted ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        data-settings-surface="true"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        className="relative w-full max-w-[900px] h-full max-h-[calc(100vh-2rem)] bg-[#F9F9F7] border border-[var(--divider-subtle)] rounded-[14px] overflow-hidden flex flex-col font-redaction transition-[opacity,transform] duration-150 md:max-h-[650px] outline-none"
        style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'scale(1)' : 'scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleFocusTrap}
      >
        {/* No title bar: the dialog is unmistakable on its own, and a strip
            that only repeated the word "Settings" cost a row of height on the
            side that has the least of it. Close floats over the content pane
            instead, out of the sidebar's column. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="absolute right-3 top-3 z-10 p-1 rounded-[3px] border border-transparent text-[var(--text-secondary)] transition-colors hover:bg-[#D45555] hover:text-white hover:border-[#2D2D2B]"
        >
          <X size={18} />
        </button>

        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          <SettingsSidebar activeTab={activeTab} setActiveTab={setActiveTab} onRevealSetting={revealSetting} />

          {/* Content. The pane is wrapped so a fade can sit above it: without
              one, content scrolls right up under the floating close button and
              cuts off against the dialog's top edge. The gradient is the pane's
              own background, so it reads as the content dissolving rather than
              as a bar. */}
          <div className="relative flex-1 min-h-0 flex">
          <div
            id={`settings-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeTab}`}
            className="flex-1 p-4 pr-12 pt-14 bg-[#F9F9F7] overflow-y-auto [scrollbar-gutter:stable] sm:p-6 sm:pr-12 sm:pt-14 md:p-8 md:pr-14 md:pt-14"
          >
            {activeTab === 'appearance' && (
              <AppearanceSettings settings={settings} updateSettings={updateSettings} />
            )}

            {(activeTab === 'general' || activeTab === 'notes') && (
              <div className="space-y-8">
                <WritingSettings
                  group={activeTab}
                  settings={settings}
                  updateSettings={updateSettings}
                  editorViewMode={editorViewMode}
                  setEditorViewMode={setEditorViewMode}
                />
                {activeTab === 'general' && (
                <SettingSection title="Keyboard Shortcuts" description="Shortcuts work anywhere in the app, including while typing.">
                  <table className="w-full text-xs font-redaction">
                    <tbody>
                      {[
                        ['Cmd/Ctrl + N', 'New note'],
                        ['Cmd/Ctrl + F', 'Focus search'],
                        ['Cmd/Ctrl + Shift + F', 'Toggle focus mode'],
                        ['Cmd/Ctrl + K', 'Open command palette'],
                        ['Cmd/Ctrl + Shift + K', "Open today's daily note"],
                        ['Cmd/Ctrl + S', 'Force save pending edits'],
                        ['Escape', 'Clear search / close panel'],
                      ].map(([key, desc]) => (
                        <tr key={key}>
                          <td className="py-1.5 pr-4 font-medium text-[#CC7D5E] whitespace-nowrap w-44 align-top">{key}</td>
                          <td className="py-1.5 text-[#2D2D2B]/60">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SettingSection>
                )}
              </div>
            )}

            {activeTab === 'workspace' && (
              <DataSettings
                group="workspace"
                workspaceName={workspaceName}
                onRenameWorkspace={onRenameWorkspace}
                notes={notes}
                folders={folders}
                onImportData={onImportData}
                fsHandle={fsHandle}
                onConnectFs={onConnectFs}
                onDisconnectFs={onDisconnectFs}
                fsLastSyncAt={fsLastSyncAt}
                fsSyncError={fsSyncError}
                syncStatus={syncStatus}
                onRetryFsSync={onRetryFsSync}
                autoBackup={autoBackup}
              />
            )}

            {activeTab === 'data' && (
              <DataSettings
                group="backup"
                workspaceName={workspaceName}
                onRenameWorkspace={onRenameWorkspace}
                notes={notes}
                folders={folders}
                onImportData={onImportData}
                fsHandle={fsHandle}
                onConnectFs={onConnectFs}
                onDisconnectFs={onDisconnectFs}
                fsLastSyncAt={fsLastSyncAt}
                fsSyncError={fsSyncError}
                syncStatus={syncStatus}
                onRetryFsSync={onRetryFsSync}
                autoBackup={autoBackup}
              />
            )}

            {activeTab === 'about' && (
              <div className="space-y-8">
                <SettingSection bare title="Noa" description="A local-first Markdown knowledge base. Notes live in this device's browser storage — no account, no server, no sync.">
                  <img
                    src={fable5VerifiedBadge}
                    alt="Fable 5 Verified"
                    className="h-8 w-auto block select-none pointer-events-none"
                    draggable={false}
                  />
                </SettingSection>
                <AppUpdateSettings />
                <SettingSection bare title="Feedback" description="Open a GitHub issue with a prefilled template. Nothing is collected automatically.">
                  <a
                    href={feedbackUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border border-[#2D2D2B] rounded-[3px] transition-colors text-sm hover:opacity-90"
                  >
                    <span>Send Feedback</span>
                  </a>
                </SettingSection>
                <SettingSection bare title="Diagnostics" description="Export a local-only diagnostics bundle for support. Nothing is uploaded.">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={handleExportDiagnostics}
                      className="inline-flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border border-[#2D2D2B] rounded-[3px] transition-colors text-sm hover:bg-[#EFEAE3]"
                      disabled={diagnosticsState === 'exporting'}
                    >
                      <span>{diagnosticsState === 'exporting' ? 'Preparing…' : 'Export Diagnostics'}</span>
                    </button>
                    {diagnosticsState === 'success' && (
                      <span className="text-xs text-[#2D2D2B]/70">Saved to your downloads.</span>
                    )}
                    {diagnosticsState === 'error' && (
                      <span className="text-xs text-[#A93B3B]">Export failed. Try again.</span>
                    )}
                  </div>
                </SettingSection>
              </div>
            )}
          </div>
            <div
              aria-hidden="true"
              // Opaque down to 40px — just past the close button's lower edge
              // (top-3 + p-1 + 18px icon = 38px) — then a short fade. Content
              // scrolling up is fully hidden by the time it reaches the button
              // and dissolves below it, instead of sliding past it to the top.
              className="pointer-events-none absolute inset-x-0 top-0 h-[46px]"
              style={{
                background: 'linear-gradient(to bottom, var(--bg-primary, #F9F9F7) 0 40px, transparent)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
