import React, { useEffect, useState } from 'react';
import { Settings, X, Book } from 'lucide-react';
import { Note, Folder, AppSettings, SyncStatus } from '../../types';
import SettingsSidebar, { SettingsTab } from './SettingsSidebar';
import AppearanceSettings from './sections/AppearanceSettings';
import DataSettings from './sections/DataSettings';
import EditorSettings from './sections/EditorSettings';
import AppUpdateSettings from './sections/AppUpdateSettings';

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
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm p-4 transition-opacity duration-150"
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
                settings={settings}
                updateSettings={updateSettings}
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
                <div className="border-2 border-[#2D2D2D] overflow-hidden">
                  <div className="bg-[#DCD9CE] px-4 py-2 border-b border-[#2D2D2D]">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#2D2D2D]/70">Keyboard Shortcuts</span>
                  </div>
                  <table className="w-full text-sm font-redaction">
                    <tbody>
                      {[
                        ['Cmd/Ctrl + N', 'New note'],
                        ['Cmd/Ctrl + F', 'Focus search'],
                        ['Cmd/Ctrl + K', 'Open command palette'],
                        ['Cmd/Ctrl + Shift + K', 'Open today\'s daily note'],
                        ['Cmd/Ctrl + S', 'Force save pending edits'],
                        ['Escape', 'Clear search / close panel'],
                      ].map(([key, desc]) => (
                        <tr key={key} className="border-b border-[#2D2D2D]/10 last:border-0">
                          <td className="px-4 py-2 font-bold text-[#B89B5E] whitespace-nowrap w-48">{key}</td>
                          <td className="px-4 py-2 text-[#2D2D2D]/70">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="p-6 border-2 border-[#2D2D2D] bg-[#DCD9CE] flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="w-16 h-16 bg-[#B89B5E] border-2 border-[#2D2D2D] flex items-center justify-center">
                    <Book size={32} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl tracking-widest uppercase">Noa</h3>
                    <p className="text-sm text-[#2D2D2D]/70 mt-1">Version {import.meta.env.PACKAGE_VERSION}</p>
                  </div>
                  <p className="text-sm max-w-sm mt-4">
                    A retro-styled, local-first Markdown knowledge base. Built with React, Tailwind CSS, and a lot of redaction.
                  </p>
                  <div className="pt-4 flex space-x-4 text-xs font-bold text-[#B89B5E]">
                    <span>#local-first</span>
                    <span>#markdown</span>
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
