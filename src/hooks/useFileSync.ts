import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, Note, SyncStatus } from '../types';
import {
  classifySyncError,
  connectDirectoryAndSeed,
  disconnectDirectory,
  mergeScannedNotes,
  restorePersistedFsHandle,
  retryFullSync,
  syncFolderRename,
  syncNoteMove,
  syncNoteDelete,
  syncNoteRename,
  syncNoteUpdate,
} from '../services/fileSyncService';
import { fromSyncError } from '../lib/appErrors';
import { recordErrorSnapshot } from '../lib/errorSnapshots';

interface UseFileSyncOptions {
  isLoaded: boolean;
  notes: Note[];
  folders: Folder[];
  workspaceName: string;
  activeNoteId: string;
  ensureInitialNote: () => void;
  onImportData: (notes: Note[], folders?: Folder[], workspaceName?: string, shouldPrune?: boolean) => Promise<void>;
}

interface UseFileSyncResult {
  fsHandle: FileSystemDirectoryHandle | null;
  syncStatus: SyncStatus;
  fsLastSyncAt: string | null;
  fsSyncError: string | null;
  permissionRevoked: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  retry: () => void;
  reconnect: () => Promise<void>;
  syncNoteOnUpdate: (id: string, content: string) => void;
  syncNoteOnMove: (id: string, previousFolderId: string, nextFolderId: string) => void;
  syncNoteOnRename: (id: string, newTitle: string) => void;
  syncFolderOnRename: (folderId: string, previousName: string, nextFolders: Folder[]) => void;
  syncNoteOnDelete: (id: string) => void;
}

const AUTO_RETRY_INITIAL_DELAY_MS = 400;
const AUTO_RETRY_MULTIPLIER = 2;
const AUTO_RETRY_MAX_DELAY_MS = 5_000;
const AUTO_RETRY_MAX_ATTEMPTS = 3;

function isObsidianImportedNote(note: Note): boolean {
  return (note.source ?? 'noa') === 'obsidian-import';
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
  const [permissionRevoked, setPermissionRevoked] = useState(false);
  const autoRetryAttempts = useRef(0);
  const autoRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapped = useRef(false);
  const notesRef = useRef(notes);
  const foldersRef = useRef(folders);
  const workspaceNameRef = useRef(workspaceName);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { foldersRef.current = folders; }, [folders]);
  useEffect(() => { workspaceNameRef.current = workspaceName; }, [workspaceName]);

  const clearRetryTimer = useCallback(() => {
    if (!autoRetryTimer.current) return;
    clearTimeout(autoRetryTimer.current);
    autoRetryTimer.current = null;
  }, []);

  const resetRetryState = useCallback(() => {
    clearRetryTimer();
    autoRetryAttempts.current = 0;
  }, [clearRetryTimer]);

  const recordSuccess = useCallback(() => {
    setSyncStatus('ready');
    setFsLastSyncAt(new Date().toISOString());
    setFsSyncError(null);
    setPermissionRevoked(false);
    resetRetryState();
  }, [resetRetryState]);

  const recordFailure = useCallback((error: unknown) => {
    const normalized = classifySyncError(error);
    const appError = fromSyncError(error);
    setSyncStatus('error');
    setFsSyncError(appError.userMessage || normalized.message);
    recordErrorSnapshot({
      at: new Date().toISOString(),
      operation: 'file_sync',
      code: appError.code,
      message: normalized.message,
      suggestedAction: appError.suggestedAction,
    });
  }, []);

  const scheduleRetry = useCallback(() => {
    if (!fsHandle) return;
    if (autoRetryTimer.current) return;
    if (autoRetryAttempts.current >= AUTO_RETRY_MAX_ATTEMPTS) {
      setPermissionRevoked(true);
      return;
    }

    autoRetryAttempts.current += 1;
    const baseDelay = Math.min(
      AUTO_RETRY_INITIAL_DELAY_MS * (AUTO_RETRY_MULTIPLIER ** (autoRetryAttempts.current - 1)),
      AUTO_RETRY_MAX_DELAY_MS,
    );
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseDelay * 0.25)));
    const delay = baseDelay + jitter;

    autoRetryTimer.current = setTimeout(() => {
      autoRetryTimer.current = null;
      if (!fsHandle) return;
      setSyncStatus('syncing');
      const managedNotes = notesRef.current.filter(isObsidianImportedNote);
      void retryFullSync(fsHandle, managedNotes, foldersRef.current)
        .then(recordSuccess)
        .catch((error) => {
          recordFailure(error);
          scheduleRetry();
        });
    }, delay);
  }, [fsHandle, recordFailure, recordSuccess]);

  const retry = useCallback(() => {
    if (!fsHandle || syncStatus === 'syncing') return;
    resetRetryState();
    setPermissionRevoked(false);
    setSyncStatus('syncing');
    const managedNotes = notesRef.current.filter(isObsidianImportedNote);
    void retryFullSync(fsHandle, managedNotes, foldersRef.current)
      .then(recordSuccess)
      .catch(recordFailure);
  }, [fsHandle, syncStatus, recordFailure, recordSuccess, resetRetryState]);

  const reconnect = useCallback(async () => {
    if (!fsHandle || syncStatus === 'syncing') return;
    resetRetryState();
    setPermissionRevoked(false);
    setFsSyncError(null);
    setSyncStatus('syncing');
    try {
      if (typeof fsHandle.requestPermission === 'function') {
        const permission = await fsHandle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
          throw new Error('File system permission denied.');
        }
      }
      const managedNotes = notesRef.current.filter(isObsidianImportedNote);
      await retryFullSync(fsHandle, managedNotes, foldersRef.current);
      recordSuccess();
    } catch (error) {
      setPermissionRevoked(true);
      recordFailure(error);
      throw error;
    }
  }, [fsHandle, syncStatus, resetRetryState, recordFailure, recordSuccess]);

  useEffect(() => () => {
    clearRetryTimer();
  }, [clearRetryTimer]);

  useEffect(() => {
    if (!isLoaded) {
      bootstrapped.current = false;
      resetRetryState();
      return;
    }
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    if (!activeNoteId) {
      ensureInitialNote();
    }

    void restorePersistedFsHandle().then(async (handle) => {
        if (!handle) {
          setSyncStatus('idle');
          setPermissionRevoked(false);
          return;
        }

      try {
        setSyncStatus('syncing');
        setFsHandle(handle);
        const currentNotes = notesRef.current;
        const currentFolders = foldersRef.current;
        const merged = await mergeScannedNotes(handle, currentNotes, currentFolders);
        if (merged.length > currentNotes.length) {
          await onImportData(merged, currentFolders, workspaceNameRef.current);
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
    resetRetryState,
  ]);

  const connect = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      const currentNotes = notesRef.current;
      const currentFolders = foldersRef.current;
      const managedNotes = currentNotes.filter(isObsidianImportedNote);
      const handle = await connectDirectoryAndSeed(managedNotes, currentFolders);
      const merged = await mergeScannedNotes(handle, currentNotes, currentFolders);
      setFsHandle(handle);
      if (merged.length > currentNotes.length) {
        await onImportData(merged, currentFolders, workspaceNameRef.current);
      }
      recordSuccess();
    } catch (error) {
      recordFailure(error);
      throw error;
    }
  }, [onImportData, recordFailure, recordSuccess]);

  const disconnect = useCallback(async () => {
    await disconnectDirectory();
    resetRetryState();
    setFsHandle(null);
    setSyncStatus('idle');
    setFsSyncError(null);
    setPermissionRevoked(false);
  }, [resetRetryState]);

  const syncNoteOnUpdate = useCallback(
    (id: string, content: string) => {
      if (!fsHandle) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note || !isObsidianImportedNote(note)) return;

      setSyncStatus('syncing');
      void syncNoteUpdate(fsHandle, note, content, foldersRef.current)
        .then(recordSuccess)
        .catch((error) => {
          recordFailure(error);
          scheduleRetry();
        });
    },
    [fsHandle, recordFailure, recordSuccess, scheduleRetry],
  );

  const syncNoteOnMove = useCallback(
    (id: string, previousFolderId: string, nextFolderId: string) => {
      if (!fsHandle) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note || !isObsidianImportedNote(note)) return;
      const nextFolder = foldersRef.current.find((folder) => folder.id === nextFolderId);
      const previousNote = { ...note, folder: previousFolderId };
      setSyncStatus('syncing');
      if ((nextFolder?.source ?? 'noa') !== 'obsidian-import') {
        // Moving out of Vault: delete the old file, no new file to write.
        void syncNoteDelete(fsHandle, previousNote, foldersRef.current)
          .then(recordSuccess)
          .catch((error) => {
            recordFailure(error);
            scheduleRetry();
          });
        return;
      }
      const movedNote = { ...note, folder: nextFolderId, updatedAt: new Date().toISOString() };
      void syncNoteMove(fsHandle, previousNote, movedNote, foldersRef.current)
        .then(recordSuccess)
        .catch((error) => {
          recordFailure(error);
          scheduleRetry();
        });
    },
    [fsHandle, recordFailure, recordSuccess, scheduleRetry],
  );

  const syncNoteOnRename = useCallback(
    (id: string, newTitle: string) => {
      if (!fsHandle) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note || !isObsidianImportedNote(note)) return;

      setSyncStatus('syncing');
      void syncNoteRename(fsHandle, note, newTitle, foldersRef.current)
        .then(recordSuccess)
        .catch((error) => {
          recordFailure(error);
          scheduleRetry();
        });
    },
    [fsHandle, recordFailure, recordSuccess, scheduleRetry],
  );

  const syncNoteOnDelete = useCallback(
    (id: string) => {
      if (!fsHandle) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note || !isObsidianImportedNote(note)) return;

      setSyncStatus('syncing');
      void syncNoteDelete(fsHandle, note, foldersRef.current)
        .then(recordSuccess)
        .catch((error) => {
          recordFailure(error);
          scheduleRetry();
        });
    },
    [fsHandle, recordFailure, recordSuccess, scheduleRetry],
  );

  const syncFolderOnRename = useCallback(
    (folderId: string, previousName: string, nextFolders: Folder[]) => {
      if (!fsHandle) return;
      const targetFolder = foldersRef.current.find((folder) => folder.id === folderId);
      if ((targetFolder?.source ?? 'noa') !== 'obsidian-import') return;
      setSyncStatus('syncing');
      void syncFolderRename(fsHandle, folderId, previousName, nextFolders, notesRef.current)
        .then(recordSuccess)
        .catch((error) => {
          recordFailure(error);
          scheduleRetry();
        });
    },
    [fsHandle, recordFailure, recordSuccess, scheduleRetry],
  );

  return {
    fsHandle,
    syncStatus,
    fsLastSyncAt,
    fsSyncError,
    permissionRevoked,
    connect,
    disconnect,
    retry,
    reconnect,
    syncNoteOnUpdate,
    syncNoteOnMove,
    syncNoteOnRename,
    syncFolderOnRename,
    syncNoteOnDelete,
  };
}
