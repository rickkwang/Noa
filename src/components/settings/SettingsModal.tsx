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
import SettingsButton, { settingsButtonClass } from './SettingsButton';
import SettingSection from './SettingSection';
import { SettingsIndexEntry, settingAnchorId } from './settingsIndex';
import SettingsSidebar, { SETTINGS_TABS, SettingsTab } from './SettingsSidebar';
import { X } from '@/src/lib/icons';

interface SettingsModalProps {
  onClose: () => void;
  initialTab?: SettingsTab;
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
  initialTab,
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
    // An explicit target (e.g. the sidebar's "Manage vault…") wins over the
    // remembered tab; the modal remounts per open, so this only steers that one.
    if (initialTab) return initialTab;
    const saved = lsGet(STORAGE_KEYS.SETTINGS_ACTIVE_TAB);
    // Maps tab ids saved by earlier layouts to their current equivalents.
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

  // Flags the open dialog so index.css lays an opaque floor under the translucent sidebar; blurring alpha haloes glyphs.
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

  // An injected tab is a one-shot destination, not a new preference: persisting
  // it would make "Workspace settings…" the landing tab for every later open.
  const skipTabPersist = useRef(Boolean(initialTab));
  useEffect(() => {
    if (skipTabPersist.current) {
      skipTabPersist.current = false;
      return;
    }
    lsSet(STORAGE_KEYS.SETTINGS_ACTIVE_TAB, activeTab);
  }, [activeTab]);

  // Search reveal: switching tabs unmounts the panel, so the scroll waits for the target; the flash marks the matched row.
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  const revealSetting = (entry: SettingsIndexEntry) => {
    setActiveTab(entry.tab);
    setPendingReveal(settingAnchorId(entry.label));
  };

  // Timer lives in a ref, not the effect cleanup: clearing pendingReveal re-runs the effect and would cancel it, leaving the reveal stuck.
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
      // Escape in a text field or select belongs to the control (would drop unsaved drafts); radio/checkbox/range/search hold no draft, so Escape still closes there.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      // Inline edit drafts handle Escape themselves.
      if (el?.closest('[data-inline-edit]')) return;
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

  // A drag-select released over the scrim clicks the scrim, so the press must start there too.
  const pressStartedOnBackdrop = useRef(false);

  return (
    <div
      data-settings-backdrop="true"
      className="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm p-4 transition-opacity duration-150"
      style={{ backgroundColor: mounted ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0)' }}
      onMouseDown={(e) => { pressStartedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (pressStartedOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
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
        {/* No title bar; close floats over the content pane. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="absolute right-3 top-3 z-10 p-1 rounded-[3px] border border-transparent text-[var(--text-secondary)] transition-colors hover:bg-[#D45555] hover:text-white"
        >
          <X size={18} />
        </button>

        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          <SettingsSidebar activeTab={activeTab} setActiveTab={setActiveTab} onRevealSetting={revealSetting} />

          {/* Wrapper lets a top fade sit over the content so it dissolves under the close button rather than cutting off. */}
          <div className="relative flex-1 min-h-0 flex">
          <div
            id={`settings-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeTab}`}
            className="noa-settings-scroll flex-1 p-4 pr-12 pt-14 bg-[#F9F9F7] overflow-y-auto [scrollbar-gutter:stable] sm:p-6 sm:pr-12 sm:pt-14 md:p-8 md:pr-14 md:pt-14"
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
                <SettingSection id={settingAnchorId('Keyboard Shortcuts')} title="Keyboard Shortcuts" description="Shortcuts work anywhere in the app, including while typing.">
                  <table className="w-full text-xs font-redaction">
                    <caption className="sr-only">Keyboard shortcuts</caption>
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
                    className={settingsButtonClass({ variant: 'primary' })}
                  >
                    <span>Send Feedback</span>
                  </a>
                </SettingSection>
                <SettingSection bare title="Diagnostics" description="Export a local-only diagnostics bundle for support. Nothing is uploaded.">
                  <div className="flex flex-wrap items-center gap-3">
                    <SettingsButton
                      onClick={handleExportDiagnostics}
                      disabled={diagnosticsState === 'exporting'}
                    >
                      <span>{diagnosticsState === 'exporting' ? 'Preparing…' : 'Export Diagnostics'}</span>
                    </SettingsButton>
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
              // Opaque to 40px (past the close button), then fades out over 24px. The only always-on fade in the app; it shields the close button.
              // Stops at the 6px scrollbar strip.
              className="pointer-events-none absolute left-0 right-[6px] top-0 h-[64px]"
              style={{
                background: 'linear-gradient(to bottom, color-mix(in srgb, var(--bg-primary, #FCFCFB) 100%, transparent) 40px, color-mix(in srgb, var(--bg-primary, #FCFCFB) 96%, transparent) 43px, color-mix(in srgb, var(--bg-primary, #FCFCFB) 84%, transparent) 46px, color-mix(in srgb, var(--bg-primary, #FCFCFB) 68%, transparent) 49px, color-mix(in srgb, var(--bg-primary, #FCFCFB) 50%, transparent) 52px, color-mix(in srgb, var(--bg-primary, #FCFCFB) 32%, transparent) 55px, color-mix(in srgb, var(--bg-primary, #FCFCFB) 16%, transparent) 58px, color-mix(in srgb, var(--bg-primary, #FCFCFB) 4%, transparent) 61px, color-mix(in srgb, var(--bg-primary, #FCFCFB) 0%, transparent) 64px)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
