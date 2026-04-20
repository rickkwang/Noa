import React, { useEffect, useMemo, useState } from 'react';
import { Settings, X, Book } from 'lucide-react';
import { Note, Folder, AppSettings, SyncStatus } from '../../types';
import { UseAutoBackupResult } from '../../hooks/useAutoBackup';
import SettingsSidebar, { SettingsTab } from './SettingsSidebar';
import AppearanceSettings from './sections/AppearanceSettings';
import DataSettings from './sections/DataSettings';
import EditorSettings from './sections/EditorSettings';
import AppUpdateSettings from './sections/AppUpdateSettings';
import { buildDiagnostics, downloadDiagnostics } from '../../lib/diagnostics';

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
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [mounted, setMounted] = useState(false);
  const [diagnosticsState, setDiagnosticsState] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle');
  useEffect(() => { setMounted(true); }, []);

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
      className="absolute inset-0 z-[60] flex items-center justify-center backdrop-blur-sm p-4 transition-opacity duration-150"
      style={{ backgroundColor: mounted ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0)' }}
    >
      <div
        className="w-full max-w-[850px] h-full max-h-[650px] bg-[#EAE8E0] border-2 border-[#2D2D2D] flex flex-col font-redaction transition-all duration-150"
        style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'scale(1)' : 'scale(0.97)' }}
      >
        {/* Title Bar */}
        <div className="h-10 border-b-2 border-[#2D2D2D] flex items-center justify-between px-4 bg-[#DCD9CE] shrink-0">
          <div className="flex items-center space-x-2">
            <Settings size={16} className="text-[#2D2D2D]" />
            <span className="font-bold tracking-widest uppercase text-sm">SETTINGS</span>
          </div>
          <button onClick={onClose} className="hover:bg-red-500 hover:text-white p-1 border border-transparent hover:border-[#2D2D2D] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <SettingsSidebar activeTab={activeTab} setActiveTab={setActiveTab} />

          {/* Content */}
          <div className="flex-1 p-8 bg-[#EAE8E0] overflow-y-auto">
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
                  <h2 className="font-bold mb-2 text-lg">About</h2>
                  <p className="text-[#2D2D2D]/70 text-sm">A retro-styled, local-first Markdown knowledge base. All data lives in your browser — no accounts, no servers.</p>
                </div>
                <div className="border-2 border-[#2D2D2D] bg-[#DCD9CE] p-4 space-y-3">
                  <div>
                    <h3 className="font-bold text-sm uppercase tracking-wider text-[#2D2D2D]/70">Feedback</h3>
                    <p className="text-xs text-[#2D2D2D]/70 mt-1">
                      Send feedback with a prefilled template. Nothing is collected automatically.
                    </p>
                  </div>
                  <a
                    href={feedbackMailto}
                    className="inline-flex items-center justify-center space-x-2 bg-[#B89B5E] text-white px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm"
                  >
                    <span>Send Feedback</span>
                  </a>
                </div>
                <div className="border-2 border-[#2D2D2D] bg-[#DCD9CE] p-4 space-y-3">
                  <div>
                    <h3 className="font-bold text-sm uppercase tracking-wider text-[#2D2D2D]/70">Diagnostics</h3>
                    <p className="text-xs text-[#2D2D2D]/70 mt-1">
                      Export a local-only diagnostics bundle for support. Nothing is uploaded.
                    </p>
                  </div>
                  <button
                    onClick={handleExportDiagnostics}
                    className="inline-flex items-center justify-center space-x-2 bg-[#EAE8E0] text-[#2D2D2D] px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm"
                    disabled={diagnosticsState === 'exporting'}
                  >
                    <span>{diagnosticsState === 'exporting' ? 'Preparing…' : 'Export Diagnostics'}</span>
                  </button>
                  {diagnosticsState === 'success' && (
                    <p className="text-xs text-[#2D2D2D]/70">Diagnostics exported locally.</p>
                  )}
                  {diagnosticsState === 'error' && (
                    <p className="text-xs text-red-700">Diagnostics export failed. Try again.</p>
                  )}
                </div>
                <div className="border-2 border-[#2D2D2D] overflow-hidden">
                  <div className="bg-[#DCD9CE] px-4 py-1.5 border-b border-[#2D2D2D]">
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
                        <tr key={key} className="border-b border-[#2D2D2D]/15 last:border-0">
                          <td className="px-4 py-1.5 font-bold text-[#B89B5E] whitespace-nowrap w-48">{key}</td>
                          <td className="px-4 py-1.5 text-[#2D2D2D]/60">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-2 border-[#2D2D2D] bg-[#DCD9CE] px-4 py-3 flex items-center gap-4">
                  <div className="w-10 h-10 bg-[#B89B5E] border-2 border-[#2D2D2D] flex items-center justify-center shrink-0">
                    <Book size={20} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-bold tracking-widest uppercase text-sm">Noa</span>
                      <span className="text-xs text-[#2D2D2D]/50">v{import.meta.env.PACKAGE_VERSION}</span>
                    </div>
                    <p className="text-xs text-[#2D2D2D]/50 mt-0.5">Local-first Markdown knowledge base · React · Tailwind</p>
                  </div>
                  <div className="flex gap-2 text-[10px] font-bold text-[#B89B5E] shrink-0">
                    <span>#local-first</span>
                    <span>#redaction</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
