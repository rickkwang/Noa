import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, Note, SyncStatus } from '../types';
import {
  classifySyncError,
  connectDirectoryAndSeed,
  disconnectDirectory,
  mergeScannedNotes,
  restorePersistedFsHandle,
  retryFullSync,
  syncNoteDelete,
  syncNoteRename,
  syncNoteUpdate,
} from '../services/fileSyncService';

interface UseFileSyncOptions {
  isLoaded: boolean;
  notes: Note[];
  folders: Folder[];
  workspaceName: string;
  activeNoteId: string;
  ensureInitialNote: () => void;
  onImportData: (notes: Note[], folders?: Folder[], workspaceName?: string) => void;
}

interface UseFileSyncResult {
  fsHandle: FileSystemDirectoryHandle | null;
  syncStatus: SyncStatus;
  fsLastSyncAt: string | null;
  fsSyncError: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  retry: () => void;
  syncNoteOnUpdate: (id: string, content: string) => void;
  syncNoteOnRename: (id: string, newTitle: string) => void;
  syncNoteOnDelete: (id: string) => void;
}

export function useFileSync({
  isLoaded,
  notes,
  folders,
  workspaceName,
  activeNoteId,
  ensureInitialNote,
  onImportData,
}: UseFileSyncOptions): UseFileSyncResult {
  const [fsHandle, setFsHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [fsLastSyncAt, setFsLastSyncAt] = useState<string | null>(null);
  const [fsSyncError, setFsSyncError] = useState<string | null>(null);
  const autoRetryAttempted = useRef(false);
  const bootstrapped = useRef(false);
  const notesRef = useRef(notes);
  const foldersRef = useRef(folders);
  const workspaceNameRef = useRef(workspaceName);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { foldersRef.current = folders; }, [folders]);
  useEffect(() => { workspaceNameRef.current = workspaceName; }, [workspaceName]);

  const recordSuccess = useCallback(() => {
    setSyncStatus('ready');
    setFsLastSyncAt(new Date().toISOString());
    setFsSyncError(null);
    autoRetryAttempted.current = false;
  }, []);

  const recordFailure = useCallback((error: unknown) => {
    const normalized = classifySyncError(error);
    setSyncStatus('error');
    setFsSyncError(normalized.message);
  }, []);

  const retry = useCallback(() => {
    if (!fsHandle) return;
    setSyncStatus('syncing');
    void retryFullSync(fsHandle, notesRef.current, foldersRef.current)
      .then(recordSuccess)
      .catch(recordFailure);
  }, [fsHandle, recordFailure, recordSuccess]);

  useEffect(() => {
    if (!isLoaded || bootstrapped.current) return;
    bootstrapped.current = true;

    if (!activeNoteId) {
      ensureInitialNote();
    }

    void restorePersistedFsHandle().then(async (handle) => {
      if (!handle) {
        setSyncStatus('idle');
        return;
      }

      try {
        setSyncStatus('syncing');
        setFsHandle(handle);
        const currentNotes = notesRef.current;
        const currentFolders = foldersRef.current;
        const merged = await mergeScannedNotes(handle, currentNotes, currentFolders);
        if (merged.length > currentNotes.length) {
          onImportData(merged, currentFolders, workspaceNameRef.current);
        }
        recordSuccess();
      } catch (error) {
        recordFailure(error);
      }
    });
  }, [
    activeNoteId,
    ensureInitialNote,
    isLoaded,
    onImportData,
    recordFailure,
    recordSuccess,
  ]);

  const connect = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      const handle = await connectDirectoryAndSeed(notes, folders);
      const merged = await mergeScannedNotes(handle, notes, folders);
      setFsHandle(handle);
      if (merged.length > notes.length) {
        onImportData(merged, folders, workspaceName);
      }
      recordSuccess();
    } catch (error) {
      recordFailure(error);
      throw error;
    }
  }, [folders, notes, onImportData, recordFailure, recordSuccess, workspaceName]);

  const disconnect = useCallback(async () => {
    await disconnectDirectory();
    setFsHandle(null);
    setSyncStatus('idle');
    setFsSyncError(null);
  }, []);

  const syncNoteOnUpdate = useCallback(
    (id: string, content: string) => {
      if (!fsHandle) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note) return;

      setSyncStatus('syncing');
      void syncNoteUpdate(fsHandle, note, content, foldersRef.current)
        .then(recordSuccess)
        .catch((error) => {
          recordFailure(error);
          if (!autoRetryAttempted.current) {
            autoRetryAttempted.current = true;
            retry();
          }
        });
    },
    [fsHandle, recordFailure, recordSuccess, retry],
  );

  const syncNoteOnRename = useCallback(
    (id: string, newTitle: string) => {
      if (!fsHandle) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note) return;

      setSyncStatus('syncing');
      void syncNoteRename(fsHandle, note, newTitle, foldersRef.current)
        .then(recordSuccess)
        .catch((error) => {
          recordFailure(error);
          if (!autoRetryAttempted.current) {
            autoRetryAttempted.current = true;
            retry();
          }
        });
    },
    [fsHandle, recordFailure, recordSuccess, retry],
  );

  const syncNoteOnDelete = useCallback(
    (id: string) => {
      if (!fsHandle) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note) return;

      setSyncStatus('syncing');
      void syncNoteDelete(fsHandle, note, foldersRef.current)
        .then(recordSuccess)
        .catch((error) => {
          recordFailure(error);
          if (!autoRetryAttempted.current) {
            autoRetryAttempted.current = true;
            retry();
          }
        });
    },
    [fsHandle, recordFailure, recordSuccess, retry],
  );

  return {
    fsHandle,
    syncStatus,
    fsLastSyncAt,
    fsSyncError,
    connect,
    disconnect,
    retry,
    syncNoteOnUpdate,
    syncNoteOnRename,
    syncNoteOnDelete,
  };
}
