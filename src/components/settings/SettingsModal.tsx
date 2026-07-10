import React, { useEffect, useMemo, useState } from 'react';
import { Settings, X } from '@/src/lib/icons';
import { Note, Folder, AppSettings, SyncStatus } from '../../types';
import { UseAutoBackupResult } from '../../hooks/useAutoBackup';
import SettingsSidebar, { SETTINGS_TABS, SettingsTab } from './SettingsSidebar';
import SettingSection from './SettingSection';
import AppearanceSettings from './sections/AppearanceSettings';
import DataSettings from './sections/DataSettings';
import EditorSettings from './sections/EditorSettings';
import AppUpdateSettings from './sections/AppUpdateSettings';
import { buildDiagnostics, downloadDiagnostics } from '../../lib/diagnostics';
import fable5VerifiedBadge from '../../assets/fable5-verified.png';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { lsGet, lsSet } from '../../lib/safeLocalStorage';

interface SettingsModalProps {
  onClose: () => void;
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  editorViewMode: 'edit' | 'preview' | 'split';
  setEditorViewMode: (mode: 'edit' | 'preview' | 'split') => void;
  notes: Note[];
  folders: Folder[];
  workspaceName: string;
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
    const validTabs = SETTINGS_TABS.map((tab) => tab.id);
    return saved && validTabs.includes(saved as SettingsTab) ? (saved as SettingsTab) : 'appearance';
  });
  const [mounted, setMounted] = useState(false);
  const [diagnosticsState, setDiagnosticsState] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle');
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    lsSet(STORAGE_KEYS.SETTINGS_ACTIVE_TAB, activeTab);
  }, [activeTab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [onClose]);

  const feedbackMailto = useMemo(() => {
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
    const subject = `Noa Feedback (${appVersion})`;
    const body = lines.join('\n');
    return `mailto:feedback@noa.app?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className="w-full max-w-[900px] h-full max-h-[calc(100vh-2rem)] bg-[#EAE8E0] border-[1.75px] border-[#2D2D2D] flex flex-col font-redaction transition-[opacity,transform] duration-150 md:max-h-[650px]"
        style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'scale(1)' : 'scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title Bar */}
        <div className="h-10 border-b-[1.75px] border-[#2D2D2D] flex items-center justify-between px-4 bg-[#DCD9CE] shrink-0">
          <div className="flex items-center space-x-2">
            <Settings size={16} className="text-[#2D2D2D]" />
            <span id="settings-dialog-title" className="font-bold tracking-widest uppercase text-sm">SETTINGS</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="hover:bg-[#D45555] hover:text-white p-1 border-[1.75px] border-transparent hover:border-[#2D2D2D] transition-colors"
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
            className="flex-1 p-4 bg-[#EAE8E0] overflow-y-auto sm:p-6 md:p-8"
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

            {activeTab === 'data' && (
              <DataSettings
                workspaceName={workspaceName}
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

            {activeTab === 'updates' && (
              <AppUpdateSettings />
            )}

            {activeTab === 'about' && (
              <div className="space-y-8">
                <div>
                  <div className="flex items-baseline gap-3">
                    <h2 className="font-bold text-lg text-[#2D2D2D]">About</h2>
                    <span className="text-base font-bold text-[#2D2D2D]">v{import.meta.env.PACKAGE_VERSION}</span>
                  </div>
                  <p className="text-sm text-[#2D2D2D]/70 mt-1">A retro-styled, local-first Markdown knowledge base. All data lives in your browser — no accounts, no servers.</p>
                  <img
                    src={fable5VerifiedBadge}
                    alt="Fable 5 Verified"
                    className="h-8 w-auto block mt-4 select-none pointer-events-none"
                    draggable={false}
                  />
                </div>
                <SettingSection bare title="Feedback" description="Send feedback with a prefilled template. Nothing is collected automatically.">
                  <a
                    href={feedbackMailto}
                    className="inline-flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border-[1.75px] border-[#2D2D2D] transition-colors text-sm"
                  >
                    <span>Send Feedback</span>
                  </a>
                </SettingSection>
                <SettingSection bare title="Diagnostics" description="Export a local-only diagnostics bundle for support. Nothing is uploaded.">
                  <div className="space-y-2">
                    <button
                      onClick={handleExportDiagnostics}
                      className="inline-flex items-center justify-center space-x-2 bg-[#EAE8E0] text-[#2D2D2D] px-4 py-2 font-bold border-[1.75px] border-[#2D2D2D] transition-colors text-sm"
                      disabled={diagnosticsState === 'exporting'}
                    >
                      <span>{diagnosticsState === 'exporting' ? 'Preparing…' : 'Export Diagnostics'}</span>
                    </button>
                    {diagnosticsState === 'success' && (
                      <p className="text-xs text-[#2D2D2D]/70">Diagnostics exported locally.</p>
                    )}
                    {diagnosticsState === 'error' && (
                      <p className="text-xs text-[#A93B3B]">Diagnostics export failed. Try again.</p>
                    )}
                  </div>
                </SettingSection>
                <div className="border-[1.75px] border-[#2D2D2D] overflow-hidden">
                  <div className="bg-[#DCD9CE] px-4 py-1.5 border-b-[1.75px] border-[#2D2D2D]">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#2D2D2D]/70">Keyboard Shortcuts</span>
                  </div>
                  <table className="w-full text-xs font-redaction">
                    <tbody>
                      {[
                        ['Cmd/Ctrl + N', 'New note'],
                        ['Cmd/Ctrl + F', 'Focus search'],
                        ['Cmd/Ctrl + K', 'Open command palette'],
                        ['Cmd/Ctrl + Shift + K', "Open today's daily note"],
                        ['Cmd/Ctrl + S', 'Force save pending edits'],
                        ['Escape', 'Clear search / close panel'],
                      ].map(([key, desc]) => (
                        <tr key={key} className="border-b-[1.75px] border-[#2D2D2D]/15 last:border-0">
                          <td className="px-4 py-1.5 font-bold text-[#CC7D5E] whitespace-nowrap w-48">{key}</td>
                          <td className="px-4 py-1.5 text-[#2D2D2D]/60">{desc}</td>
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
