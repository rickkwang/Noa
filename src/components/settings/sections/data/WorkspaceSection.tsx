import React, { RefObject, useEffect, useState } from 'react';
import SettingItem from '../../SettingItem';
import SettingSection from '../../SettingSection';
import { FolderOpen, HardDrive, Loader2, PlusSquare, Unlink } from '@/src/lib/icons';

interface WorkspaceSectionProps {
  workspaceName: string;
  onRenameWorkspace: (name: string) => void;
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
  onRenameWorkspace,
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
  const [draftName, setDraftName] = useState(workspaceName);
  useEffect(() => setDraftName(workspaceName), [workspaceName]);

  const commitName = () => {
    const name = draftName.trim();
    if (name && name !== workspaceName) {
      onRenameWorkspace(name);
    } else {
      setDraftName(workspaceName);
    }
  };

  return (
    <SettingSection title="Workspace" description="Manage your current working directory.">
      <SettingItem label="Workspace Name" description="The label used for this local workspace and exports.">
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitName();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setDraftName(workspaceName);
            }
          }}
          maxLength={60}
          aria-label="Workspace name"
          className="bg-[#F9F9F7] border border-[#2D2D2B] rounded-md px-3 py-1.5 text-sm w-56 font-redaction shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.1)] outline-none focus:border-[#CC7D5E]"
        />
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
          className="flex-1 flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border border-[#2D2D2B] rounded-md transition-colors text-sm"
        >
          <FolderOpen size={14} />
          <span>Import Vault Folder</span>
        </button>
        <button
          onClick={onCreateWorkspace}
          className="flex-1 flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border border-[#2D2D2B] rounded-md transition-colors text-sm"
        >
          <PlusSquare size={14} />
          <span>New Workspace</span>
        </button>
      </div>

      <p className="text-xs text-[#2D2D2B]/60 mt-2 px-1">
        {isFileSystemSupported && !fsHandle
          ? 'Import Vault Folder is a one-time migration into Noa. To keep a live mirror on disk instead, use Connect Folder below.'
          : 'Import Vault Folder is a one-time migration into Noa.'}
      </p>

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
                  disabled={connectingFs}
                  className="flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border border-[#2D2D2B] rounded-md transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none"
                >
                  <Unlink size={14} />
                  <span>Disconnect</span>
                </button>
                {onRetryFsSync && (
                  <button
                    onClick={onRetryFsSync}
                    disabled={connectingFs}
                    className="flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border border-[#2D2D2B] rounded-md transition-colors text-sm hover:opacity-90 disabled:opacity-60 disabled:pointer-events-none"
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
                className="flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border border-[#2D2D2B] rounded-md transition-colors text-sm hover:opacity-90 disabled:opacity-60 disabled:pointer-events-none"
              >
                {connectingFs ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />}
                <span>{connectingFs ? 'Connecting…' : 'Connect Folder'}</span>
              </button>
            )}

            <p className="text-xs text-[#2D2D2B]/60">
              Sync status: {syncStatusLabel}.
              {fsLastSyncAt && ` Last successful sync: ${new Date(fsLastSyncAt).toLocaleString()}.`}
              {fsHandle && ' Edits sync both ways; new notes created in Noa stay local.'}
            </p>
            {fsSyncError && (
              <p className="text-xs text-[#2D2D2B] border border-[#CC7D5E]/50 bg-[#F9F9F7] rounded-md px-2 py-1">
                Sync error: {fsSyncError}
              </p>
            )}
          </div>
        </SettingItem>
      )}
    </SettingSection>
  );
}
