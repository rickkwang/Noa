import React, { useRef, useState } from 'react';
import { UseAutoBackupResult } from '../../../hooks/useAutoBackup';
import { useDataTransfer, ConfirmRequest, DataTransferMessage } from '../../../hooks/useDataTransfer';
import { useStorageEstimate } from '../../../hooks/useStorageEstimate';
import { getBackupHealth } from '../../../lib/backupHealth';
import { getLastExportAt } from '../../../lib/exportTimestamp';
import { isFileSystemSupported } from '../../../lib/fileSystemStorage';
import { LOCAL_DATA_BOUNDARY_COPY, LOCAL_DATA_RECOMMENDED_FLOW_COPY } from '../../../lib/userFacingCopy';
import { Folder, Note, SyncStatus } from '../../../types';
import AutoBackupSection from './data/AutoBackupSection';
import BackupSection from './data/BackupSection';
import ImportSection from './data/ImportSection';
import { ConfirmState } from './data/types';
import WorkspaceSection from './data/WorkspaceSection';

interface DataSettingsProps {
  group: 'workspace' | 'backup';
  workspaceName: string;
  onRenameWorkspace: (name: string) => void;
  notes: Note[];
  folders: Folder[];
  onImportData: (notes: Note[], folders?: Folder[], workspaceName?: string, shouldPrune?: boolean) => Promise<void>;
  fsHandle: FileSystemDirectoryHandle | null;
  fsLastSyncAt?: string | null;
  fsSyncError?: string | null;
  syncStatus: SyncStatus;
  onConnectFs: () => Promise<void>;
  onDisconnectFs: () => Promise<void>;
  onRetryFsSync?: () => void;
  autoBackup: UseAutoBackupResult;
}


export default function DataSettings({
  group,
  workspaceName,
  onRenameWorkspace,
  notes,
  folders,
  onImportData,
  fsHandle,
  fsLastSyncAt,
  fsSyncError,
  syncStatus,
  onConnectFs,
  onDisconnectFs,
  onRetryFsSync,
  autoBackup,
}: DataSettingsProps) {
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<DataTransferMessage | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // Confirm and message render at the top of this (scrollable) tab while their
  // triggers live further down — without this they appear out of view and the
  // import looks like it did nothing.
  React.useEffect(() => {
    if (confirmState) confirmRef.current?.scrollIntoView({ block: 'nearest' });
  }, [confirmState]);
  React.useEffect(() => {
    if (message) messageRef.current?.scrollIntoView({ block: 'nearest' });
  }, [message]);
  const [importStrategy, setImportStrategy] = useState<'overwrite' | 'merge' | 'skip'>('skip');
  const storageEstimate = useStorageEstimate();
  const [lastExportAt, setLastExportAt] = useState<string | null>(() => getLastExportAt());
  const backupHealth = getBackupHealth(lastExportAt);

  const requestConfirm = (request: ConfirmRequest) => {
    setImportStrategy('skip');
    setConfirmState({
      message: request.message,
      inputLabel: request.inputLabel,
      inputValue: request.defaultInput,
      onConfirm: request.onConfirm,
      conflictSummary: request.conflictSummary,
      onStrategyChange: request.onStrategyChange,
    });
  };

  const transfer = useDataTransfer({
    notes,
    folders,
    workspaceName,
    onImportData,
    onConnectFolder: onConnectFs,
    onDisconnectFolder: onDisconnectFs,
    notify: setMessage,
    requestConfirm,
  });

  const handleImportJsonInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    transfer.importJsonFile(file);
  };

  const handleImportFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.currentTarget.value = '';
    if (!files || files.length === 0) return;
    transfer.importFolderFiles(files);
  };

  React.useEffect(() => {
    const handler = () => setLastExportAt(getLastExportAt());
    window.addEventListener('redaction-exported', handler);
    return () => window.removeEventListener('redaction-exported', handler);
  }, []);

  const isWorking = transfer.importingData || transfer.exportingZip || transfer.exportingHtml || transfer.connectingFs;

  return (
    <div className="space-y-8">
      {isWorking && (
        <div className="border border-[#CC7D5E] bg-[#F9F9F7] rounded-md px-3 py-2 font-redaction text-sm text-[#2D2D2B] flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full border border-[#2D2D2B] border-t-transparent animate-spin shrink-0" />
          <span>
            {transfer.importingData
              ? (transfer.importStatusText ?? 'Importing data...')
              : transfer.connectingFs
                ? 'Connecting...'
                : 'Exporting...'}
          </span>
        </div>
      )}
      {group === 'backup' && (
        <div className="border border-[#2D2D2B]/20 bg-[#EFEAE3] rounded-md px-3 py-2 text-xs text-[#2D2D2B]/70">
          {LOCAL_DATA_BOUNDARY_COPY}
          <div className="mt-1">{LOCAL_DATA_RECOMMENDED_FLOW_COPY}</div>
        </div>
      )}
      {confirmState && (
        <div ref={confirmRef} className="border border-[#CC7D5E] bg-[#CC7D5E]/10 rounded-lg p-3 flex flex-col gap-2 font-redaction">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-[#2D2D2B] flex-1">{confirmState.message}</p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => {
                  confirmState.onConfirm(confirmState.inputValue);
                  setConfirmState(null);
                }}
                className="px-3 py-1 text-xs font-bold bg-[#CC7D5E] text-white border border-[#2D2D2B] rounded-md hover:opacity-90"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmState(null)}
                className="px-3 py-1 text-xs font-bold bg-[#F9F9F7] border border-[#2D2D2B] rounded-md hover:bg-[#EFEAE3]"
              >
                Cancel
              </button>
            </div>
          </div>
          {confirmState.conflictSummary && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-[#2D2D2B]/70">
                {confirmState.conflictSummary.sameIdCount + confirmState.conflictSummary.dupeTitleCount} conflict(s) —{' '}
                {confirmState.conflictSummary.sameIdCount} same ID,{' '}
                {confirmState.conflictSummary.dupeTitleCount} similar title,{' '}
                {confirmState.conflictSummary.newCount} new
              </p>
              <div className="flex flex-col gap-1">
                {(['overwrite', 'merge', 'skip'] as const).map((s) => {
                  const labels: Record<string, string> = {
                    overwrite: 'Overwrite all',
                    merge: 'Merge (keep both)',
                    skip: 'Skip conflicts',
                  };
                  const descriptions: Record<string, string> = {
                    overwrite: 'Replace all current notes with imported notes.',
                    merge: 'Conflicting ID/title notes are renamed "(imported)" and added.',
                    skip: 'Only import notes with no ID/title conflict.',
                  };
                  return (
                    <label key={s} className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="import-strategy"
                        value={s}
                        checked={importStrategy === s}
                        onChange={() => {
                          setImportStrategy(s);
                          confirmState.onStrategyChange?.(s);
                        }}
                        className="mt-0.5 accent-[#CC7D5E]"
                      />
                      <span className="text-xs text-[#2D2D2B]">
                        <span className="font-bold">{labels[s]}</span>
                        <span className="text-[#2D2D2B]/60 ml-1">— {descriptions[s]}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {confirmState.inputLabel && (
            <div className="flex items-center gap-2 mt-1">
              <label className="text-xs text-[#2D2D2B]/70 shrink-0">{confirmState.inputLabel}</label>
              <input
                type="text"
                value={confirmState.inputValue ?? ''}
                onChange={(e) =>
                  setConfirmState((prev) => (prev ? { ...prev, inputValue: e.target.value } : null))
                }
                className="flex-1 bg-[#F9F9F7] border border-[#2D2D2B] rounded-md px-2 py-1 text-sm font-redaction outline-none focus:border-[#CC7D5E]"
                autoFocus
              />
            </div>
          )}
        </div>
      )}

      {message && (
        <div
          ref={messageRef}
          className={`border rounded-md p-3 flex items-center justify-between font-redaction text-sm ${
            message.type === 'success'
              ? 'border-[#CC7D5E] bg-[#CC7D5E]/10 text-[#2D2D2B]'
              : 'border-[#D45555]/60 bg-[#D45555]/10 text-[#A93B3B]'
          }`}
        >
          <span>
            <span className="mr-1.5 text-[10px] uppercase tracking-wider font-bold">
              {message.type === 'success' ? 'Success' : 'Error'}
            </span>
            {message.text}
            {message.code ? ` (${message.code})` : ''}
            {message.suggestedAction ? ` · Suggested action: ${message.suggestedAction}` : ''}
          </span>
          <button
            onClick={() => setMessage(null)}
            className="ml-2 opacity-60 hover:opacity-100 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {group === 'workspace' && (
        <WorkspaceSection
          workspaceName={workspaceName}
          onRenameWorkspace={onRenameWorkspace}
          folderInputRef={folderInputRef}
          onImportFolderInput={handleImportFolderInput}
          onImportVaultFolder={() => {
            void transfer.importVaultFolder();
          }}
          onCreateWorkspace={transfer.createNewWorkspace}
          isFileSystemSupported={isFileSystemSupported()}
          fsHandle={fsHandle}
          syncStatusLabel={syncStatus}
          fsLastSyncAt={fsLastSyncAt}
          fsSyncError={fsSyncError}
          connectingFs={transfer.connectingFs || syncStatus === 'syncing'}
          onConnectFolder={() => {
            void transfer.connectFolder();
          }}
          onDisconnectFolder={() => {
            void transfer.disconnectFolder();
          }}
          onRetryFsSync={onRetryFsSync}
        />
      )}

      {group === 'backup' && (
        <>
          <BackupSection
            exportingZip={transfer.exportingZip}
            exportingHtml={transfer.exportingHtml}
            onExportJson={transfer.exportJson}
            onExportZip={() => {
              void transfer.exportZip();
            }}
            onExportHtmlZip={() => {
              void transfer.exportHtmlZip();
            }}
            storageEstimate={storageEstimate}
            backupHealth={backupHealth.status}
            daysSinceExport={backupHealth.daysSinceExport}
            lastExportAt={backupHealth.lastExportAt}
          />

          <AutoBackupSection
            status={autoBackup.backupStatus}
            error={autoBackup.backupError}
            lastAutoBackupAt={autoBackup.lastAutoBackupAt}
            directoryName={autoBackup.directoryName}
            hasBackupHandle={autoBackup.hasBackupHandle}
            onChooseDirectory={autoBackup.chooseDirectory}
            onDisconnect={autoBackup.disconnect}
            onRunNow={autoBackup.runNow}
            onReconnect={autoBackup.reconnect}
          />

          <ImportSection
            jsonInputRef={jsonInputRef}
            onImportJsonInput={handleImportJsonInput}
          />
        </>
      )}
    </div>
  );
}
