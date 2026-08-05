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
import EditorSettings from './sections/EditorSettings';
import SettingSection from './SettingSection';
import SettingsSidebar, { SETTINGS_TABS, SettingsTab } from './SettingsSidebar';
import { Settings, X } from '@/src/lib/icons';

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
    // Tabs were reorganized: Data split into Workspace + Backup & Import,
    // App Update folded into About.
    const legacyMap: Record<string, SettingsTab> = { data: 'workspace', updates: 'about' };
    const mapped = saved ? (legacyMap[saved] ?? saved) : null;
    const validTabs = SETTINGS_TABS.map((tab) => tab.id);
    return mapped && validTabs.includes(mapped as SettingsTab) ? (mapped as SettingsTab) : 'editor';
  });
  const [mounted, setMounted] = useState(false);
  const [diagnosticsState, setDiagnosticsState] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle');
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMounted(true); }, []);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape inside a text field or select belongs to the control, not the
      // dialog: editable fields (template form, workspace name) cancel their
      // own draft and a select closes its dropdown — closing the dialog here
      // would drop unsaved edits. Radio/checkbox/range inputs hold no draft,
      // so Escape there still closes.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (tag === 'INPUT') {
        const type = (el as HTMLInputElement).type;
        if (!['radio', 'checkbox', 'range', 'button', 'submit', 'file', 'color'].includes(type)) return;
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
      className="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm p-4 transition-opacity duration-150"
      style={{ backgroundColor: mounted ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabIndex={-1}
        className="w-full max-w-[900px] h-full max-h-[calc(100vh-2rem)] bg-[#F9F9F7] border border-[#2D2D2B] rounded-xl overflow-hidden flex flex-col font-redaction transition-[opacity,transform] duration-150 md:max-h-[650px] outline-none"
        style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'scale(1)' : 'scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleFocusTrap}
      >
        {/* Title Bar */}
        <div className="h-10 border-b border-[#2D2D2B] flex items-center justify-between px-4 bg-[#EFEAE3] shrink-0">
          <div className="flex items-center space-x-2">
            <Settings size={16} className="text-[#2D2D2B]" />
            <span id="settings-dialog-title" className="font-bold tracking-widest uppercase text-sm">SETTINGS</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="hover:bg-[#D45555] hover:text-white p-1 border border-transparent hover:border-[#2D2D2B] rounded-md transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          <SettingsSidebar activeTab={activeTab} setActiveTab={setActiveTab} />

          {/* Content */}
          <div
            id={`settings-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeTab}`}
            className="flex-1 p-4 bg-[#F9F9F7] overflow-y-auto [scrollbar-gutter:stable] sm:p-6 md:p-8"
          >
            {activeTab === 'appearance' && (
              <AppearanceSettings settings={settings} updateSettings={updateSettings} />
            )}

            {activeTab === 'editor' && (
              <EditorSettings 
                settings={settings} 
                updateSettings={updateSettings} 
                editorViewMode={editorViewMode}
                setEditorViewMode={setEditorViewMode}
              />
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

            {activeTab === 'backup' && (
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
                <div>
                  <h2 className="font-bold text-lg text-[#2D2D2B]">About</h2>
                  <p className="text-sm text-[#2D2D2B]/70 mt-1">A retro-styled, local-first Markdown knowledge base. All data lives in your browser — no accounts, no servers.</p>
                  <img
                    src={fable5VerifiedBadge}
                    alt="Fable 5 Verified"
                    className="h-8 w-auto block mt-4 select-none pointer-events-none"
                    draggable={false}
                  />
                </div>
                <AppUpdateSettings />
                <SettingSection bare title="Feedback" description="Open a GitHub issue with a prefilled template. Nothing is collected automatically.">
                  <a
                    href={feedbackUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border border-[#2D2D2B] rounded-md transition-colors text-sm hover:opacity-90"
                  >
                    <span>Send Feedback</span>
                  </a>
                </SettingSection>
                <SettingSection bare title="Diagnostics" description="Export a local-only diagnostics bundle for support. Nothing is uploaded.">
                  <div className="space-y-2">
                    <button
                      onClick={handleExportDiagnostics}
                      className="inline-flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border border-[#2D2D2B] rounded-md transition-colors text-sm hover:bg-[#EFEAE3]"
                      disabled={diagnosticsState === 'exporting'}
                    >
                      <span>{diagnosticsState === 'exporting' ? 'Preparing…' : 'Export Diagnostics'}</span>
                    </button>
                    {diagnosticsState === 'success' && (
                      <p className="text-xs text-[#2D2D2B]/70">Diagnostics exported locally.</p>
                    )}
                    {diagnosticsState === 'error' && (
                      <p className="text-xs text-[#A93B3B]">Diagnostics export failed. Try again.</p>
                    )}
                  </div>
                </SettingSection>
                <div className="border border-[#2D2D2B] rounded-lg overflow-hidden">
                  <div className="bg-[#EFEAE3] px-4 py-1.5 border-b border-[#2D2D2B]">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#2D2D2B]/70">Keyboard Shortcuts</span>
                  </div>
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
                        <tr key={key} className="border-b border-[#2D2D2B]/15 last:border-0">
                          <td className="px-4 py-1.5 font-bold text-[#CC7D5E] whitespace-nowrap w-48">{key}</td>
                          <td className="px-4 py-1.5 text-[#2D2D2B]/60">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
