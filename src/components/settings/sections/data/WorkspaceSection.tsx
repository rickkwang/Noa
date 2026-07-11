import React, { RefObject } from 'react';
import { FolderOpen, HardDrive, Loader2, PlusSquare, Unlink } from '@/src/lib/icons';
import SettingItem from '../../SettingItem';
import SettingSection from '../../SettingSection';

interface WorkspaceSectionProps {
  workspaceName: string;
  folderInputRef: RefObject<HTMLInputElement | null>;
  onImportFolderInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImportVaultFolder: () => void;
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
  onImportVaultFolder,
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
      <SettingItem label="Workspace Name" description="The label used for this local workspace and exports.">
        <div className="bg-[#F9F9F7] border-[1.75px] border-[#2D2D2B] px-3 py-1.5 text-sm font-redaction shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.1)]">
          {workspaceName}
        </div>
      </SettingItem>

      <div className="flex space-x-4 mt-4">
        <button
          onClick={() => {
            if (typeof window.showDirectoryPicker === 'function') {
              onImportVaultFolder();
              return;
            }
            folderInputRef.current?.click();
          }}
          className="flex-1 flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border-[1.75px] border-[#2D2D2B] transition-colors text-sm"
        >
          <FolderOpen size={14} />
          <span>Import Vault Folder</span>
        </button>
        <button
          onClick={onCreateWorkspace}
          className="flex-1 flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border-[1.75px] border-[#2D2D2B] transition-colors text-sm"
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
        data-testid="vault-folder-input"
        className="hidden"
        ref={folderInputRef}
        onChange={onImportFolderInput}
      />

      {isFileSystemSupported && (
        <SettingItem
          label="Vault Folder"
          description={fsHandle ? `Using ${fsHandle.name} as the Markdown vault (${syncStatusLabel})` : 'Connect a folder to make Markdown files on disk the source of truth.'}
          stacked
        >
          <div className="space-y-2">
            {fsHandle ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={onDisconnectFolder}
                  className="flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border-[1.75px] border-[#2D2D2B] transition-colors text-sm"
                >
                  <Unlink size={14} />
                  <span>Disconnect</span>
                </button>
                {onRetryFsSync && (
                  <button
                    onClick={onRetryFsSync}
                    className="flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border-[1.75px] border-[#2D2D2B] transition-colors text-sm"
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
                className="flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border-[1.75px] border-[#2D2D2B] transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none"
              >
                {connectingFs ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />}
                <span>{connectingFs ? 'Connecting…' : 'Connect Folder'}</span>
              </button>
            )}

            {fsLastSyncAt && (
              <p className="text-xs text-[#2D2D2B]/60">
                Last successful sync: {new Date(fsLastSyncAt).toLocaleString()}
              </p>
            )}
            <p className="text-xs text-[#2D2D2B]/60">
              Sync status: {syncStatusLabel}. When a vault is connected, Noa refreshes its local cache from the Markdown files on disk. Edits, renames and deletions made in other apps are picked up automatically.
            </p>
            <p className="text-xs text-[#2D2D2B]/60">
              Notes created in Noa are written to the connected folder as Markdown with recoverable Noa identity metadata.
            </p>
            <p className="text-xs text-[#2D2D2B]/60">
              Importing a vault folder is a one-time migration into Noa. It preserves the folder tree and notes so you can continue editing here.
            </p>
            {fsSyncError && (
              <p className="text-xs text-[#2D2D2B] border-[1.75px] border-[#CC7D5E]/50 bg-[#F9F9F7] px-2 py-1">
                Sync error: {fsSyncError}
              </p>
            )}
          </div>
        </SettingItem>
      )}
    </SettingSection>
  );
}
