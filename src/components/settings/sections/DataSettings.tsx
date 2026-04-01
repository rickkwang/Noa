import React, { useRef, useState } from 'react';
import { Folder, Note, SyncStatus } from '../../../types';
import { useDataTransfer, ConfirmRequest, DataTransferMessage } from '../../../hooks/useDataTransfer';
import { isFileSystemSupported } from '../../../lib/fileSystemStorage';
import { useStorageEstimate } from '../../../hooks/useStorageEstimate';
import BackupSection from './data/BackupSection';
import ImportSection from './data/ImportSection';
import WorkspaceSection from './data/WorkspaceSection';
import { ConfirmState } from './data/types';
import { getLastExportAt } from '../../../lib/exportTimestamp';
import { getBackupHealth } from '../../../lib/backupHealth';
import { LOCAL_DATA_BOUNDARY_COPY, LOCAL_DATA_RECOMMENDED_FLOW_COPY } from '../../../lib/userFacingCopy';

interface DataSettingsProps {
  workspaceName: string;
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
}


export default function DataSettings({
  workspaceName,
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
}: DataSettingsProps) {
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<DataTransferMessage | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [importStrategy, setImportStrategy] = useState<'overwrite' | 'merge' | 'skip'>('overwrite');
  const storageEstimate = useStorageEstimate();
  const [lastExportAt, setLastExportAt] = useState<string | null>(() => getLastExportAt());
  const backupHealth = getBackupHealth(lastExportAt);

  const requestConfirm = (request: ConfirmRequest) => {
    setImportStrategy('overwrite');
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
        <div className="border-2 border-[#B89B5E] bg-[#EAE8E0] px-3 py-2 font-redaction text-sm text-[#2D2D2D] flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-[#2D2D2D] border-t-transparent rounded-full animate-spin shrink-0" />
          <span>
            {transfer.importingData
              ? (transfer.importStatusText ?? 'Importing data...')
              : transfer.connectingFs
                ? 'Connecting...'
                : 'Exporting...'}
          </span>
        </div>
      )}
      <div className="border border-[#2D2D2D]/20 bg-[#DCD9CE] px-3 py-2 text-xs text-[#2D2D2D]/70">
        {LOCAL_DATA_BOUNDARY_COPY}
        <div className="mt-1">{LOCAL_DATA_RECOMMENDED_FLOW_COPY}</div>
      </div>
      {confirmState && (
        <div className="border-2 border-[#B89B5E] bg-[#B89B5E]/10 p-3 flex flex-col gap-2 font-redaction">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-[#2D2D2D] flex-1">{confirmState.message}</p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => {
                  confirmState.onConfirm(confirmState.inputValue);
                  setConfirmState(null);
                }}
                className="px-3 py-1 text-xs font-bold bg-[#B89B5E] text-white border-2 border-[#2D2D2D] hover:opacity-90"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmState(null)}
                className="px-3 py-1 text-xs font-bold bg-[#EAE8E0] border-2 border-[#2D2D2D] hover:bg-[#DCD9CE]"
              >
                Cancel
              </button>
            </div>
          </div>
          {confirmState.conflictSummary && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-[#2D2D2D]/70">
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
                        className="mt-0.5"
                      />
                      <span className="text-xs text-[#2D2D2D]">
                        <span className="font-bold">{labels[s]}</span>
                        {importStrategy === s && (
                          <span className="text-[#2D2D2D]/60 ml-1">— {descriptions[s]}</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {confirmState.inputLabel && (
            <div className="flex items-center gap-2 mt-1">
              <label className="text-xs text-[#2D2D2D]/70 shrink-0">{confirmState.inputLabel}</label>
              <input
                type="text"
                value={confirmState.inputValue ?? ''}
                onChange={(e) =>
                  setConfirmState((prev) => (prev ? { ...prev, inputValue: e.target.value } : null))
                }
                className="flex-1 bg-[#EAE8E0] border-2 border-[#2D2D2D] px-2 py-1 text-sm font-redaction outline-none focus:border-[#B89B5E]"
                autoFocus
              />
            </div>
          )}
        </div>
      )}

      {message && (
        <div
          className={`border-2 p-3 flex items-center justify-between font-redaction text-sm ${
            message.type === 'success'
              ? 'border-[#B89B5E] bg-[#B89B5E]/10 text-[#2D2D2D]'
              : 'border-red-400 bg-red-50 text-red-700'
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

      <WorkspaceSection
        workspaceName={workspaceName}
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
        connectingFs={transfer.connectingFs}
        onConnectFolder={() => {
          void transfer.connectFolder();
        }}
        onDisconnectFolder={() => {
          void transfer.disconnectFolder();
        }}
        onRetryFsSync={onRetryFsSync}
      />

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

      <ImportSection
        jsonInputRef={jsonInputRef}
        onImportJsonInput={handleImportJsonInput}
      />
    </div>
  );
}
