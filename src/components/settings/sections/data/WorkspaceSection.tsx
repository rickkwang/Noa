import React, { RefObject } from 'react';
import { FolderOpen, HardDrive, Loader2, PlusSquare, Unlink } from 'lucide-react';
import SettingItem from '../../SettingItem';
import SettingSection from '../../SettingSection';

interface WorkspaceSectionProps {
  workspaceName: string;
  folderInputRef: RefObject<HTMLInputElement | null>;
  onImportFolderInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCreateWorkspace: () => void;
  isFileSystemSupported: boolean;
  fsHandle: FileSystemDirectoryHandle | null;
  syncStatusLabel: string;
  fsLastSyncAt?: string | null;
  fsSyncError?: string | null;
  connectingFs: boolean;
  onConnectFolder: () => void;
  onDisconnectFolder: () => void;
  onRetryFsSync?: () => void;
}

export default function WorkspaceSection({
  workspaceName,
  folderInputRef,
  onImportFolderInput,
  onCreateWorkspace,
  isFileSystemSupported,
  fsHandle,
  syncStatusLabel,
  fsLastSyncAt,
  fsSyncError,
  connectingFs,
  onConnectFolder,
  onDisconnectFolder,
  onRetryFsSync,
}: WorkspaceSectionProps) {
  return (
    <SettingSection title="Workspace" description="Manage your current working directory.">
      <SettingItem label="Current Path" description="The active workspace location.">
        <div className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-1.5 text-sm font-redaction shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.1)]">
          ~/{workspaceName}
        </div>
      </SettingItem>

      <div className="flex space-x-4 mt-4">
        <button
          onClick={() => folderInputRef.current?.click()}
          className="flex-1 flex items-center justify-center space-x-2 bg-[#EAE8E0] text-[#2D2D2D] px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm"
        >
          <FolderOpen size={14} />
          <span>Open Folder</span>
        </button>
        <button
          onClick={onCreateWorkspace}
          className="flex-1 flex items-center justify-center space-x-2 bg-[#EAE8E0] text-[#2D2D2D] px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm"
        >
          <PlusSquare size={14} />
          <span>New Workspace</span>
        </button>
      </div>

      <input
        type="file"
        webkitdirectory
        directory
        multiple
        className="hidden"
        ref={folderInputRef}
        onChange={onImportFolderInput}
      />

      {isFileSystemSupported && (
        <SettingItem
          label="Local File Sync"
          description={fsHandle ? `Syncing to: ${fsHandle.name} (${syncStatusLabel})` : 'Directory sync helper for .md files. Not a strongly consistent two-way engine.'}
        >
          <div className="space-y-2">
            {fsHandle ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={onDisconnectFolder}
                  className="flex items-center justify-center space-x-2 bg-[#EAE8E0] text-[#2D2D2D] px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm"
                >
                  <Unlink size={14} />
                  <span>Disconnect</span>
                </button>
                {onRetryFsSync && (
                  <button
                    onClick={onRetryFsSync}
                    className="flex items-center justify-center space-x-2 bg-[#B89B5E] text-white px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm"
                  >
                    <HardDrive size={14} />
                    <span>Retry Sync</span>
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={onConnectFolder}
                disabled={connectingFs}
                className="flex items-center justify-center space-x-2 bg-[#B89B5E] text-white px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none"
              >
                {connectingFs ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />}
                <span>{connectingFs ? 'Connecting…' : 'Connect Folder'}</span>
              </button>
            )}

            {fsLastSyncAt && (
              <p className="text-xs text-[#2D2D2D]/60">
                Last successful sync: {new Date(fsLastSyncAt).toLocaleString()}
              </p>
            )}
            <p className="text-xs text-[#2D2D2D]/60">
              Sync status: {syncStatusLabel}. If conflicts happen, use import strategy or manual review before overwrite.
            </p>
            {fsSyncError && (
              <p className="text-xs text-red-700 border border-red-300 bg-red-50 px-2 py-1">
                Sync error: {fsSyncError}
              </p>
            )}
          </div>
        </SettingItem>
      )}
    </SettingSection>
  );
}
