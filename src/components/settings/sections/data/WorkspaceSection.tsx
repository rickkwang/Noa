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
          className="bg-[#F9F9F7] border border-[#2D2D2B] rounded-[3px] px-3 py-1.5 text-sm w-56 font-redaction outline-none focus:border-[#CC7D5E]"
        />
      </SettingItem>

      {/* One action per row, each with its own explanation, so the card keeps
          the label-left / control-right rhythm the rest of the settings use.
          The two buttons previously shared a full-width row with a single
          caption underneath, which left the caption ambiguous between them and
          stretched both buttons far past the size of their labels. */}
      <SettingItem
        label="Import Vault Folder"
        description={isFileSystemSupported && !fsHandle
          ? 'A one-time migration into Noa. To keep a live mirror on disk instead, connect a vault folder below.'
          : 'A one-time migration into Noa.'}
      >
        <button
          onClick={() => {
            if (typeof window.showDirectoryPicker === 'function') {
              onImportVaultFolder();
              return;
            }
            folderInputRef.current?.click();
          }}
          className="w-full md:w-auto flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border border-[#2D2D2B] rounded-[3px] transition-colors text-sm"
        >
          <FolderOpen size={14} />
          <span>Import</span>
        </button>
      </SettingItem>

      <SettingItem label="New Workspace" description="Start an empty workspace. The current one stays on this device.">
        <button
          onClick={onCreateWorkspace}
          className="w-full md:w-auto flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border border-[#2D2D2B] rounded-[3px] transition-colors text-sm"
        >
          <PlusSquare size={14} />
          <span>Create</span>
        </button>
      </SettingItem>

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
          <div className="space-y-3">
            {fsHandle ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={onDisconnectFolder}
                  disabled={connectingFs}
                  className="flex items-center justify-center space-x-2 bg-[#F9F9F7] text-[#2D2D2B] px-4 py-2 font-bold border border-[#2D2D2B] rounded-[3px] transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none"
                >
                  <Unlink size={14} />
                  <span>Disconnect</span>
                </button>
                {onRetryFsSync && (
                  <button
                    onClick={onRetryFsSync}
                    disabled={connectingFs}
                    className="flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border border-[#2D2D2B] rounded-[3px] transition-colors text-sm hover:opacity-90 disabled:opacity-60 disabled:pointer-events-none"
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
                className="flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border border-[#2D2D2B] rounded-[3px] transition-colors text-sm hover:opacity-90 disabled:opacity-60 disabled:pointer-events-none"
              >
                {connectingFs ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />}
                <span>{connectingFs ? 'Connecting…' : 'Connect Folder'}</span>
              </button>
            )}

            <p className="text-xs text-[#2D2D2B]/60 leading-relaxed">
              {fsLastSyncAt && `Last successful sync: ${new Date(fsLastSyncAt).toLocaleString()}. `}
              {fsHandle
                ? 'Edits sync both ways; new notes created in Noa stay local.'
                : `Sync status: ${syncStatusLabel}.`}
            </p>
            {fsSyncError && (
              <p className="text-xs text-[#2D2D2B] border border-[#CC7D5E]/50 bg-[#F9F9F7] rounded-[3px] px-2 py-1">
                Sync error: {fsSyncError}
              </p>
            )}
          </div>
        </SettingItem>
      )}
    </SettingSection>
  );
}
