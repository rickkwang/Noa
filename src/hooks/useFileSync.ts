import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, Note, SyncStatus } from '../types';
import {
  checkExternalVaultChanges,
  classifySyncError,
  connectDirectoryAndSeed,
  disconnectDirectory,
  mergeScannedNotes,
  resetVaultStatSnapshot,
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
  onImportData: (notes: Note[], folders?: Folder[], workspaceName?: string, shouldPrune?: boolean, deletedNoteIds?: string[]) => Promise<void>;
}

interface UseFileSyncResult {
  fsHandle: FileSystemDirectoryHandle | null;
  syncStatus: SyncStatus;
  fsLastSyncAt: string | null;
  fsSyncError: string | null;
  permissionRevoked: boolean;
  needsReauth: boolean;
  autoRetryExhausted: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  retry: () => void;
  reconnect: () => Promise<void>;
  syncNoteOnUpdate: (id: string, content: string) => void;
  syncNoteOnMove: (id: string, previousFolderId: string, nextFolderId: string) => void;
  syncNoteOnRename: (id: string, newTitle: string) => void;
  syncFolderOnRename: (folderId: string, previousName: string, nextFolders: Folder[]) => void;
  syncNoteOnDelete: (id: string) => void;
  /** Transient notice after external vault changes were merged in; auto-clears. */
  externalUpdateNotice: string | null;
}

const AUTO_RETRY_INITIAL_DELAY_MS = 400;
const AUTO_RETRY_MULTIPLIER = 2;
const AUTO_RETRY_MAX_DELAY_MS = 15_000;
const AUTO_RETRY_MAX_ATTEMPTS = 5;

// External-change polling cadence. The FSA API has no watcher; window focus is
// the primary signal (returning from Obsidian/Finder), the interval the backstop.
const EXTERNAL_POLL_INTERVAL_MS = 60_000;

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
  const [needsReauth, setNeedsReauth] = useState(false);
  const [autoRetryExhausted, setAutoRetryExhausted] = useState(false);
  const permissionRevoked = needsReauth || autoRetryExhausted;
  const autoRetryAttempts = useRef(0);
  const autoRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapped = useRef(false);
  const notesRef = useRef(notes);
  const foldersRef = useRef(folders);
  const workspaceNameRef = useRef(workspaceName);
  const fsHandleRef = useRef(fsHandle);
  useEffect(() => {
    notesRef.current = notes;
    foldersRef.current = folders;
    workspaceNameRef.current = workspaceName;
  }, [notes, folders, workspaceName]);
  useEffect(() => { fsHandleRef.current = fsHandle; }, [fsHandle]);

  // Tracks the retry-generation id. Every user-initiated reset (retry/reconnect/
  // disconnect) bumps this so any timer or in-flight retry callback scheduled
  // under an older generation becomes a no-op when it eventually fires.
  const retryGeneration = useRef(0);

  const clearRetryTimer = useCallback(() => {
    if (!autoRetryTimer.current) return;
    clearTimeout(autoRetryTimer.current);
    autoRetryTimer.current = null;
  }, []);

  const resetRetryState = useCallback(() => {
    clearRetryTimer();
    autoRetryAttempts.current = 0;
    // Invalidate any in-flight retry callback so it becomes a no-op when it
    // eventually settles (see scheduleRetry's generation check).
    retryGeneration.current += 1;
  }, [clearRetryTimer]);

  const recordSuccess = useCallback(() => {
    setSyncStatus('ready');
    setFsLastSyncAt(new Date().toISOString());
    setFsSyncError(null);
    setNeedsReauth(false);
    setAutoRetryExhausted(false);
    resetRetryState();
  }, [resetRetryState]);

  const recordFailure = useCallback((error: unknown) => {
    const normalized = classifySyncError(error);
    const appError = fromSyncError(error);
    setSyncStatus('error');
    setFsSyncError(appError.userMessage || normalized.message);
    if (normalized.code === 'permission_denied') {
      setNeedsReauth(true);
    }
    recordErrorSnapshot({
      at: new Date().toISOString(),
      operation: 'file_sync',
      code: appError.code,
      message: normalized.message,
      suggestedAction: appError.suggestedAction,
    });
  }, []);

  const scheduleRetry = useCallback(() => {
    if (!fsHandleRef.current) return;
    if (autoRetryTimer.current) return;
    if (autoRetryAttempts.current >= AUTO_RETRY_MAX_ATTEMPTS) {
      setAutoRetryExhausted(true);
      return;
    }

    autoRetryAttempts.current += 1;
    const baseDelay = Math.min(
      AUTO_RETRY_INITIAL_DELAY_MS * (AUTO_RETRY_MULTIPLIER ** (autoRetryAttempts.current - 1)),
      AUTO_RETRY_MAX_DELAY_MS,
    );
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseDelay * 0.25)));
    const delay = baseDelay + jitter;

    const generation = retryGeneration.current;
    autoRetryTimer.current = setTimeout(() => {
      autoRetryTimer.current = null;
      // If resetRetryState ran while we were waiting, our generation is stale.
      // Aborting here prevents a dead branch from resurrecting sync after the
      // user disconnected or manually retried.
      if (generation !== retryGeneration.current) return;
      const handle = fsHandleRef.current;
      if (!handle) return;
      setSyncStatus('syncing');
      void retryFullSync(handle, notesRef.current, foldersRef.current)
        .then(() => {
          if (generation !== retryGeneration.current) return;
          recordSuccess();
        })
        .catch((error) => {
          if (generation !== retryGeneration.current) return;
          recordFailure(error);
          // Permission errors need user re-auth; don't burn the retry budget on
          // them — recordFailure has already raised needsReauth.
          if (classifySyncError(error).code === 'permission_denied') return;
          scheduleRetry();
        });
    }, delay);
  }, [recordFailure, recordSuccess]); // fsHandleRef is a ref, not reactive — read inside callback

  const retry = useCallback(() => {
    if (!fsHandle || syncStatus === 'syncing') return;
    resetRetryState();
    // Keep autoRetryExhausted sticky through the attempt so the Disconnect
    // escape hatch stays visible if this manual retry also fails.
    // recordSuccess clears it on the happy path.
    setSyncStatus('syncing');
    void retryFullSync(fsHandle, notesRef.current, foldersRef.current)
      .then(recordSuccess)
      .catch(recordFailure);
  }, [fsHandle, syncStatus, recordFailure, recordSuccess, resetRetryState]);

  const reconnect = useCallback(async () => {
    if (!fsHandle || syncStatus === 'syncing') return;
    resetRetryState();
    setSyncStatus('syncing');
    try {
      if (typeof fsHandle.requestPermission === 'function') {
        const permission = await fsHandle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
          throw new Error('File system permission denied.');
        }
      }
      // Permission re-granted — clear reauth flag before running the sync.
      setNeedsReauth(false);
      setAutoRetryExhausted(false);
      setFsSyncError(null);
      const currentNotes = notesRef.current;
      const currentFolders = foldersRef.current;
      const { notes: merged, newFolders, deletedNoteIds } = await mergeScannedNotes(fsHandle, currentNotes, currentFolders);
      const mergedFolders = [...currentFolders, ...newFolders];
      // Always prune so vault deletions are removed from storage.
      await onImportData(merged, mergedFolders, workspaceNameRef.current, true, deletedNoteIds);
      await retryFullSync(fsHandle, merged, mergedFolders);
      recordSuccess();
    } catch (error) {
      recordFailure(error);
    }
  }, [fsHandle, syncStatus, resetRetryState, recordFailure, recordSuccess, onImportData]);

  useEffect(() => () => {
    clearRetryTimer();
  }, [clearRetryTimer]);

  useEffect(() => {
    if (!isLoaded) {
      bootstrapped.current = false;
      resetRetryState();
      setSyncStatus('idle');
      return;
    }
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    // Captured for the async chain below: if isLoaded flips false again
    // before restore resolves, bootstrapped.current will have been reset,
    // signalling that we should abandon the in-flight restore.
    const bootstrapToken = bootstrapped;

    if (!activeNoteId) {
      ensureInitialNote();
    }

    void restorePersistedFsHandle().then(async (handle) => {
      if (!bootstrapToken.current) return;
      if (!handle) {
        setSyncStatus('idle');
        setNeedsReauth(false);
        setAutoRetryExhausted(false);
        return;
      }
      try {
        if (!bootstrapToken.current) return;
        setSyncStatus('syncing');
        setFsHandle(handle);
        const currentNotes = notesRef.current;
        const currentFolders = foldersRef.current;
        const { notes: merged, newFolders, deletedNoteIds } = await mergeScannedNotes(handle, currentNotes, currentFolders);
        const mergedFolders = [...currentFolders, ...newFolders];
        try {
          // Always prune so vault deletions are removed from storage.
          await onImportData(merged, mergedFolders, workspaceNameRef.current, true, deletedNoteIds);
        } catch (importError) {
          recordFailure(importError);
          return;
        }
        // Write back any Noa edits made while the app was closed (e.g. offline edits
        // from a previous session that never flushed to disk). This also performs
        // the one-time migration of Noa-native notes onto disk.
        await retryFullSync(handle, merged, mergedFolders);
        recordSuccess();
      } catch (error) {
        recordFailure(error);
      }
    }).catch(recordFailure);
  }, [
    activeNoteId,
    ensureInitialNote,
    isLoaded,
    onImportData,
    recordFailure,
    recordSuccess,
    resetRetryState,
  ]);

  // Runtime external-change detection: poll the vault's file mtimes on window
  // focus and on an interval, and re-merge when another app changed something.
  const pollInFlight = useRef(false);
  const [externalUpdateNotice, setExternalUpdateNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showExternalUpdateNotice = useCallback((updated: number, removed: number) => {
    if (updated === 0 && removed === 0) return;
    const parts: string[] = [];
    if (updated > 0) parts.push(`${updated} note${updated === 1 ? '' : 's'} updated from disk`);
    if (removed > 0) parts.push(`${removed} removed`);
    setExternalUpdateNotice(parts.join(', '));
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setExternalUpdateNotice(null), 6_000);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);
  useEffect(() => {
    if (!fsHandle || !isLoaded) return;
    let disposed = false;

    const poll = async () => {
      if (disposed || pollInFlight.current || document.hidden) return;
      pollInFlight.current = true;
      try {
        const changed = await checkExternalVaultChanges(fsHandle);
        if (!changed || disposed) return;
        setSyncStatus('syncing');
        const currentNotes = notesRef.current;
        const currentFolders = foldersRef.current;
        const { notes: merged, newFolders, deletedNoteIds, updatedNoteIds } = await mergeScannedNotes(fsHandle, currentNotes, currentFolders);
        if (disposed) return;
        const mergedFolders = [...currentFolders, ...newFolders];
        await onImportData(merged, mergedFolders, workspaceNameRef.current, true, deletedNoteIds);
        showExternalUpdateNotice(updatedNoteIds.length, deletedNoteIds.length);
        recordSuccess();
      } catch (error) {
        if (!disposed) recordFailure(error);
      } finally {
        pollInFlight.current = false;
      }
    };

    const interval = setInterval(() => { void poll(); }, EXTERNAL_POLL_INTERVAL_MS);
    const onFocus = () => { void poll(); };
    window.addEventListener('focus', onFocus);
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fsHandle, isLoaded, onImportData, recordFailure, recordSuccess, showExternalUpdateNotice]);

  const connect = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      const currentNotes = notesRef.current;
      const currentFolders = foldersRef.current;
      const handle = await connectDirectoryAndSeed(currentNotes, currentFolders);
      const { notes: merged, newFolders, deletedNoteIds } = await mergeScannedNotes(handle, currentNotes, currentFolders);
      const mergedFolders = [...currentFolders, ...newFolders];
      setFsHandle(handle);
      try {
        await onImportData(merged, mergedFolders, workspaceNameRef.current, true, deletedNoteIds);
      } catch (importError) {
        recordFailure(importError);
        throw importError;
      }
      // Seed the vault with everything Noa holds (existing vault files were
      // already merged above, so this only fills in what's missing/stale).
      await retryFullSync(handle, merged, mergedFolders);
      recordSuccess();
    } catch (error) {
      recordFailure(error);
      throw error;
    }
  }, [onImportData, recordFailure, recordSuccess]);

  const disconnect = useCallback(async () => {
    await disconnectDirectory();
    resetVaultStatSnapshot();
    resetRetryState();
    setFsHandle(null);
    setSyncStatus('idle');
    setFsSyncError(null);
    setNeedsReauth(false);
    setAutoRetryExhausted(false);
  }, [resetRetryState]);

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
          scheduleRetry();
        });
    },
    [fsHandle, recordFailure, recordSuccess, scheduleRetry],
  );

  const syncNoteOnMove = useCallback(
    (id: string, previousFolderId: string, nextFolderId: string) => {
      if (!fsHandle) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note) return;
      const previousNote = { ...note, folder: previousFolderId };
      setSyncStatus('syncing');
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
      if (!note) return;

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
      if (!note) return;

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
      if (!targetFolder) return;
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
    needsReauth,
    autoRetryExhausted,
    connect,
    disconnect,
    retry,
    reconnect,
    syncNoteOnUpdate,
    syncNoteOnMove,
    syncNoteOnRename,
    syncFolderOnRename,
    syncNoteOnDelete,
    externalUpdateNotice,
  };
}
