import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Folder,
  Note,
  SyncStatus,
  VaultPendingOperation,
  VaultSyncedNoteExpectation,
} from '../types';
import {
  checkExternalVaultChanges,
  classifySyncError,
  connectDirectory,
  disconnectDirectory,
  getVaultIdentity,
  mergeScannedNotes,
  resetVaultStatSnapshot,
  replayVaultPendingOperation,
  restorePersistedFsHandle,
  syncFolderDelete,
  syncFolderRename,
  syncNoteMove,
  syncNoteDelete,
  syncNoteRename,
  syncNoteUpdate,
  syncVaultNoteSnapshot,
} from '../services/fileSyncService';
import { fromSyncError } from '../lib/appErrors';
import { recordErrorSnapshot } from '../lib/errorSnapshots';
import { storage } from '../lib/storage';
import {
  commitVaultPendingOperation,
  selectVaultPendingOperations,
  shouldReplayVaultPendingOperation,
} from '../lib/vaultPendingOperations';

interface UseFileSyncOptions {
  isLoaded: boolean;
  notes: Note[];
  folders: Folder[];
  workspaceName: string;
  activeNoteId: string;
  ensureInitialNote: () => void;
  onImportData: (notes: Note[], folders?: Folder[], workspaceName?: string, shouldPrune?: boolean, deletedNoteIds?: string[]) => Promise<void>;
  onVaultNotesSynced: (expectations: VaultSyncedNoteExpectation[]) => void;
}

interface UseFileSyncResult {
  fsHandle: FileSystemDirectoryHandle | null;
  syncStatus: SyncStatus;
  fsLastSyncAt: string | null;
  fsSyncError: string | null;
  permissionRevoked: boolean;
  needsReauth: boolean;
  autoRetryExhausted: boolean;
  vaultCacheReadOnly: boolean;
  authoritativeSyncInProgress: boolean;
  isAuthoritativeSyncActive: () => boolean;
  isVaultEntityOperationPending: (entityKey: string) => boolean;
  isAnyVaultStructuralOperationPending: () => boolean;
  reserveVaultStructuralOperation: (entityKey: string) => boolean;
  releaseVaultStructuralOperation: (entityKey: string) => void;
  prepareVaultStructuralOperations: (operations: readonly VaultPendingOperation[]) => Promise<void>;
  cancelVaultStructuralOperations: (operations: readonly VaultPendingOperation[]) => Promise<void>;
  hasPendingStructuralOperations: boolean;
  connect: () => Promise<void>;
  beginDisconnect: () => void;
  cancelDisconnect: () => void;
  disconnect: () => Promise<void>;
  retry: () => void;
  reconnect: () => Promise<void>;
  syncNoteOnUpdate: (id: string, content: string) => void;
  syncNoteOnMove: (note: Note, nextFolderId: string) => void;
  syncNoteOnRename: (note: Note, newTitle: string) => void;
  syncFolderOnRename: (folderId: string, previousName: string, nextFolders: Folder[], prepared?: VaultPendingOperation) => void;
  syncFolderOnDelete: (folder: Folder, prepared?: VaultPendingOperation) => void;
  syncNoteOnDelete: (note: Note, prepared?: VaultPendingOperation) => void;
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
const VAULT_AUTHORITATIVE_MERGE = { mode: 'vault-authoritative' as const };

interface TrackedSyncOperation {
  run: () => Promise<void>;
  expectation?: VaultSyncedNoteExpectation;
  failed: boolean;
  durable: boolean;
}

export function shouldLockVaultCache({
  isLoaded,
  vaultHydrationPending,
  hasFsHandle,
  vaultHydrated,
  hasSyncError,
  hasVaultOwnedData,
}: {
  isLoaded: boolean;
  vaultHydrationPending: boolean;
  hasFsHandle: boolean;
  vaultHydrated: boolean;
  hasSyncError: boolean;
  hasVaultOwnedData: boolean;
}): boolean {
  if (!isLoaded) return false;
  if (vaultHydrationPending) return true;
  if (!hasFsHandle) return hasVaultOwnedData;
  return !vaultHydrated || hasSyncError;
}

export function useFileSync({
  isLoaded,
  notes,
  folders,
  workspaceName,
  activeNoteId,
  ensureInitialNote,
  onImportData,
  onVaultNotesSynced,
}: UseFileSyncOptions): UseFileSyncResult {
  const [fsHandle, setFsHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [fsLastSyncAt, setFsLastSyncAt] = useState<string | null>(null);
  const [fsSyncError, setFsSyncError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [autoRetryExhausted, setAutoRetryExhausted] = useState(false);
  const [vaultHydrated, setVaultHydrated] = useState(false);
  const [vaultHydrationPending, setVaultHydrationPending] = useState(true);
  const [hasPendingStructuralOperations, setHasPendingStructuralOperations] = useState(false);
  const [authoritativeSyncInProgress, setAuthoritativeSyncInProgress] = useState(false);
  const permissionRevoked = needsReauth || autoRetryExhausted;
  const vaultCacheReadOnly = shouldLockVaultCache({
    isLoaded,
    vaultHydrationPending,
    hasFsHandle: Boolean(fsHandle),
    vaultHydrated,
    hasSyncError: Boolean(fsSyncError),
    hasVaultOwnedData: notes.some((note) => note.origin === 'vault')
      || folders.some((folder) => folder.origin === 'vault'),
  });
  const autoRetryAttempts = useRef(0);
  const autoRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapped = useRef(false);
  const notesRef = useRef(notes);
  const foldersRef = useRef(folders);
  const workspaceNameRef = useRef(workspaceName);
  const fsHandleRef = useRef(fsHandle);
  const vaultIdRef = useRef<string | null>(null);
  const disconnectingRef = useRef(false);
  const authoritativeWorkCountRef = useRef(0);
  const pendingStructuralOperationsRef = useRef(false);
  const reservedStructuralEntityKeysRef = useRef(new Set<string>());
  const pendingStructuralEntityKeysRef = useRef(new Set<string>());
  const trackedOperationsRef = useRef(new Map<string, TrackedSyncOperation>());
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

  const refreshStructuralPendingState = useCallback(() => {
    const pending = reservedStructuralEntityKeysRef.current.size > 0
      || pendingStructuralEntityKeysRef.current.size > 0
      || Array.from(trackedOperationsRef.current.values()).some((operation) => operation.durable);
    pendingStructuralOperationsRef.current = pending;
    setHasPendingStructuralOperations(pending);
  }, []);

  const applyPendingStructuralOperations = useCallback((operations: readonly VaultPendingOperation[]) => {
    pendingStructuralEntityKeysRef.current = new Set(operations.map((operation) => operation.entityKey));
    refreshStructuralPendingState();
  }, [refreshStructuralPendingState]);

  const recordSuccess = useCallback(() => {
    // A successful write for note B must not hide a still-failed write for
    // note A. The failed operation remains replayable until it succeeds.
    if (
      trackedOperationsRef.current.size > 0
      || authoritativeWorkCountRef.current > 0
      || pendingStructuralOperationsRef.current
    ) return;
    setSyncStatus('ready');
    setFsLastSyncAt(new Date().toISOString());
    setFsSyncError(null);
    setNeedsReauth(false);
    setAutoRetryExhausted(false);
    setVaultHydrated(true);
    setVaultHydrationPending(false);
    resetRetryState();
  }, [resetRetryState]);

  const recordFailure = useCallback((error: unknown) => {
    const normalized = classifySyncError(error);
    const appError = fromSyncError(error);
    setSyncStatus('error');
    setFsSyncError(appError.userMessage || normalized.message);
    setVaultHydrated(false);
    setVaultHydrationPending(false);
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

  const prepareNotesForAuthoritativeScan = useCallback(async (
    handle: FileSystemDirectoryHandle,
  ): Promise<{ notes: Note[]; folders: Folder[] }> => {
    const syncedNoteIds = new Set<string>();

    const vaultId = await getVaultIdentity(handle);
    vaultIdRef.current = vaultId;
    const pendingOperations = await storage.getVaultPendingOperations();
    const unboundOperations = pendingOperations.filter((operation) => !operation.vaultId);
    await Promise.all(
      unboundOperations.map((operation) => storage.removeVaultPendingOperation(operation.key)),
    );
    const durableOperations = selectVaultPendingOperations(
      pendingOperations,
      vaultId,
    );
    applyPendingStructuralOperations(durableOperations);
    for (const operation of durableOperations) {
      if (!shouldReplayVaultPendingOperation(operation, notesRef.current, foldersRef.current)) {
        await storage.removeVaultPendingOperation(operation.key);
        trackedOperationsRef.current.delete(operation.entityKey);
        continue;
      }
      const committed = commitVaultPendingOperation(operation);
      if (operation.phase === 'prepared') await storage.upsertVaultPendingOperation(committed);
      await replayVaultPendingOperation(handle, committed, notesRef.current);
      await storage.removeVaultPendingOperation(operation.key);
      trackedOperationsRef.current.delete(operation.entityKey);
    }
    if (durableOperations.length > 0) {
      const remaining = selectVaultPendingOperations(
        await storage.getVaultPendingOperations(),
        vaultId,
      );
      applyPendingStructuralOperations(remaining);
    }

    // Structural failures (delete/folder rename) cannot be recovered by merely
    // re-scanning disk. Replay the exact failed operation before disk becomes
    // authoritative again.
    for (const [key, operation] of Array.from(trackedOperationsRef.current.entries())) {
      if (!operation.failed) continue;
      await operation.run();
      if (trackedOperationsRef.current.get(key) === operation) {
        trackedOperationsRef.current.delete(key);
        if (operation.expectation) syncedNoteIds.add(operation.expectation.id);
      }
    }

    // vaultDirty survives reloads, when the in-memory failed-operation closure
    // does not. Reconcile every dirty row from its latest cached snapshot.
    const dirtySnapshots = notesRef.current.filter(
      (note) => note.origin === 'vault' && note.vaultDirty,
    );
    for (const note of dirtySnapshots) {
      await syncVaultNoteSnapshot(handle, note, foldersRef.current);
      syncedNoteIds.add(note.id);
    }

    const dirtyVersions = new Map(dirtySnapshots.map((note) => [note.id, note.updatedAt]));
    const latestNotes = notesRef.current;
    const clearedNoteIds: string[] = [];
    const scanNotes = latestNotes.map((note) => {
      // If the user edited again while recovery was writing, retain vaultDirty;
      // the next operation/retry owns that newer revision.
      if (!syncedNoteIds.has(note.id)) return note;
      const expectedVersion = dirtyVersions.get(note.id);
      if (expectedVersion && expectedVersion !== note.updatedAt) return note;
      const { vaultDirty: _vaultDirty, ...syncedNote } = note;
      clearedNoteIds.push(note.id);
      return syncedNote;
    });
    const clearedById = new Map(scanNotes.map((note) => [note.id, note]));
    onVaultNotesSynced(clearedNoteIds.flatMap((id) => {
      const note = clearedById.get(id);
      return note ? [{
        id: note.id,
        content: note.content,
        title: note.title,
        folder: note.folder,
        updatedAt: note.updatedAt,
      }] : [];
    }));
    return { notes: scanNotes, folders: foldersRef.current };
  }, [applyPendingStructuralOperations, onVaultNotesSynced]);

  const syncFromAuthoritativeDisk = useCallback(async (
    handle: FileSystemDirectoryHandle,
    generation: number,
  ): Promise<{ deletedNoteIds: string[]; updatedNoteIds: string[] } | null> => {
    // A prepared structural transaction has already reserved its local entity
    // but may still be persisting the matching local mutation. Do not let an
    // authoritative scan observe or promote that half-finished transaction.
    if (reservedStructuralEntityKeysRef.current.size > 0) return null;
    authoritativeWorkCountRef.current += 1;
    setAuthoritativeSyncInProgress(true);
    try {
      const { notes: currentNotes, folders: currentFolders } = await prepareNotesForAuthoritativeScan(handle);
      const { notes: merged, folders: mergedFolders, deletedNoteIds, updatedNoteIds } = await mergeScannedNotes(
        handle,
        currentNotes,
        currentFolders,
        VAULT_AUTHORITATIVE_MERGE,
      );
      if (generation !== retryGeneration.current || disconnectingRef.current) return null;
      await onImportData(merged, mergedFolders, workspaceNameRef.current, true, deletedNoteIds);
      if (generation !== retryGeneration.current || disconnectingRef.current) return null;
      return { deletedNoteIds, updatedNoteIds };
    } finally {
      authoritativeWorkCountRef.current = Math.max(0, authoritativeWorkCountRef.current - 1);
      setAuthoritativeSyncInProgress(authoritativeWorkCountRef.current > 0);
    }
  }, [onImportData, prepareNotesForAuthoritativeScan]);

  const isAuthoritativeSyncActive = useCallback(
    () => authoritativeWorkCountRef.current > 0,
    [],
  );

  const isAnyVaultStructuralOperationPending = useCallback(() => (
    reservedStructuralEntityKeysRef.current.size > 0
    || pendingStructuralEntityKeysRef.current.size > 0
    || Array.from(trackedOperationsRef.current.values()).some((operation) => operation.durable)
  ), []);

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
      void syncFromAuthoritativeDisk(handle, generation)
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
  }, [recordFailure, recordSuccess, syncFromAuthoritativeDisk]); // fsHandleRef is a ref, not reactive — read inside callback

  const runTrackedOperation = useCallback((
    key: string,
    run: () => Promise<void>,
    expectation?: VaultSyncedNoteExpectation,
    durableOperation?: VaultPendingOperation,
  ) => {
    if (disconnectingRef.current) return;
    const generation = retryGeneration.current;
    const execute = async () => {
      if (durableOperation) {
        const vaultId = vaultIdRef.current;
        if (!vaultId) throw new Error('Vault identity is not ready.');
        const committed = commitVaultPendingOperation({ ...durableOperation, vaultId });
        pendingStructuralOperationsRef.current = true;
        pendingStructuralEntityKeysRef.current.add(durableOperation.entityKey);
        setHasPendingStructuralOperations(true);
        await storage.upsertVaultPendingOperation(committed);
      }
      await run();
      if (durableOperation) await storage.removeVaultPendingOperation(durableOperation.key);
    };
    const operation = { run: execute, expectation, failed: false, durable: Boolean(durableOperation) };
    // A newer mutation for the same entity supersedes an older failed closure.
    trackedOperationsRef.current.set(key, operation);
    if (durableOperation) {
      // A synchronous UI reservation covers the await before local deletion.
      // The tracked operation now owns that reservation until its journal is
      // removed successfully or replayed.
      reservedStructuralEntityKeysRef.current.delete(durableOperation.entityKey);
      refreshStructuralPendingState();
    }
    setSyncStatus('syncing');
    void execute().then(async () => {
      if (durableOperation) {
        const vaultId = vaultIdRef.current;
        const remaining = vaultId
          ? selectVaultPendingOperations(await storage.getVaultPendingOperations(), vaultId)
          : [];
        applyPendingStructuralOperations(remaining);
      }
      if (generation !== retryGeneration.current || disconnectingRef.current) return;
      if (trackedOperationsRef.current.get(key) !== operation) return;
      trackedOperationsRef.current.delete(key);
      refreshStructuralPendingState();
      if (expectation) onVaultNotesSynced([expectation]);
      recordSuccess();
    }).catch((error) => {
      if (generation !== retryGeneration.current || disconnectingRef.current) return;
      if (trackedOperationsRef.current.get(key) !== operation) return;
      operation.failed = true;
      recordFailure(error);
      scheduleRetry();
    });
  }, [applyPendingStructuralOperations, onVaultNotesSynced, recordFailure, recordSuccess, refreshStructuralPendingState, scheduleRetry]);

  const retry = useCallback(() => {
    if (!fsHandle || syncStatus === 'syncing') return;
    resetRetryState();
    const generation = retryGeneration.current;
    // Keep autoRetryExhausted sticky through the attempt so the Disconnect
    // escape hatch stays visible if this manual retry also fails.
    // recordSuccess clears it on the happy path.
    setSyncStatus('syncing');
    void syncFromAuthoritativeDisk(fsHandle, generation)
      .then(() => {
        if (generation === retryGeneration.current && !disconnectingRef.current) recordSuccess();
      })
      .catch((error) => {
        if (generation === retryGeneration.current && !disconnectingRef.current) recordFailure(error);
      });
  }, [fsHandle, syncStatus, recordFailure, recordSuccess, resetRetryState, syncFromAuthoritativeDisk]);

  const reconnect = useCallback(async () => {
    if (!fsHandle || syncStatus === 'syncing') return;
    resetRetryState();
    const generation = retryGeneration.current;
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
      await syncFromAuthoritativeDisk(fsHandle, generation);
      if (generation === retryGeneration.current && !disconnectingRef.current) recordSuccess();
    } catch (error) {
      if (generation === retryGeneration.current && !disconnectingRef.current) recordFailure(error);
    }
  }, [fsHandle, syncStatus, resetRetryState, recordFailure, recordSuccess, syncFromAuthoritativeDisk]);

  useEffect(() => () => {
    clearRetryTimer();
  }, [clearRetryTimer]);

  useEffect(() => {
    if (!isLoaded) {
      bootstrapped.current = false;
      resetRetryState();
      setSyncStatus('idle');
      setVaultHydrated(false);
      setVaultHydrationPending(true);
      return;
    }
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    // Captured for the async chain below: if isLoaded flips false again
    // before restore resolves, bootstrapped.current will have been reset,
    // signalling that we should abandon the in-flight restore.
    const bootstrapToken = bootstrapped;
    const generation = retryGeneration.current;

    void restorePersistedFsHandle().then(async (handle) => {
      if (!bootstrapToken.current) return;
      if (!handle) {
        if (!activeNoteId) {
          ensureInitialNote();
        }
        setSyncStatus('idle');
        setNeedsReauth(false);
        setAutoRetryExhausted(false);
        setVaultHydrated(true);
        setVaultHydrationPending(false);
        return;
      }
      try {
        if (!bootstrapToken.current) return;
        setSyncStatus('syncing');
        setVaultHydrated(false);
        setFsHandle(handle);
        await syncFromAuthoritativeDisk(handle, generation);
        if (generation !== retryGeneration.current || disconnectingRef.current || !bootstrapToken.current) return;
        if (generation === retryGeneration.current && !disconnectingRef.current) recordSuccess();
      } catch (error) {
        if (generation === retryGeneration.current && !disconnectingRef.current) recordFailure(error);
      }
    }).catch((error) => {
      if (generation === retryGeneration.current && !disconnectingRef.current) recordFailure(error);
    });
  }, [
    activeNoteId,
    ensureInitialNote,
    isLoaded,
    recordFailure,
    recordSuccess,
    resetRetryState,
    syncFromAuthoritativeDisk,
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
      if (disposed || pollInFlight.current || document.hidden || isAnyVaultStructuralOperationPending()) return;
      const generation = retryGeneration.current;
      pollInFlight.current = true;
      try {
        const changed = await checkExternalVaultChanges(fsHandle);
        if (
          !changed
          || disposed
          || generation !== retryGeneration.current
          || disconnectingRef.current
          || isAnyVaultStructuralOperationPending()
        ) return;
        setSyncStatus('syncing');
        const result = await syncFromAuthoritativeDisk(fsHandle, generation);
        if (disposed || generation !== retryGeneration.current || disconnectingRef.current) return;
        if (!result) return;
        showExternalUpdateNotice(result.updatedNoteIds.length, result.deletedNoteIds.length);
        recordSuccess();
      } catch (error) {
        if (!disposed && generation === retryGeneration.current && !disconnectingRef.current) recordFailure(error);
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
  }, [fsHandle, isAnyVaultStructuralOperationPending, isLoaded, recordFailure, recordSuccess, showExternalUpdateNotice, syncFromAuthoritativeDisk]);

  const connect = useCallback(async () => {
    disconnectingRef.current = false;
    resetRetryState();
    const generation = retryGeneration.current;
    setSyncStatus('syncing');
    setVaultHydrated(false);
    setVaultHydrationPending(true);
    try {
      const handle = await connectDirectory();
      setFsHandle(handle);
      await syncFromAuthoritativeDisk(handle, generation);
      if (generation === retryGeneration.current && !disconnectingRef.current) recordSuccess();
    } catch (error) {
      if (generation === retryGeneration.current && !disconnectingRef.current) recordFailure(error);
      throw error;
    }
  }, [recordFailure, recordSuccess, resetRetryState, syncFromAuthoritativeDisk]);

  const beginDisconnect = useCallback(() => {
    if (authoritativeWorkCountRef.current > 0) {
      throw new Error('Vault sync is still applying disk changes. Wait for it to finish before disconnecting.');
    }
    const hasTrackedStructuralOperation = Array.from(trackedOperationsRef.current.values())
      .some((operation) => operation.durable);
    if (pendingStructuralOperationsRef.current || hasTrackedStructuralOperation) {
      throw new Error('Vault file operations are still pending. Retry sync before disconnecting.');
    }
    disconnectingRef.current = true;
    resetRetryState();
  }, [resetRetryState]);

  const isVaultEntityOperationPending = useCallback((entityKey: string) => (
    trackedOperationsRef.current.has(entityKey)
    || reservedStructuralEntityKeysRef.current.has(entityKey)
    || pendingStructuralEntityKeysRef.current.has(entityKey)
  ), []);

  const reserveVaultStructuralOperation = useCallback((entityKey: string) => {
    if (!fsHandleRef.current || isAuthoritativeSyncActive() || isAnyVaultStructuralOperationPending()) return false;
    reservedStructuralEntityKeysRef.current.add(entityKey);
    refreshStructuralPendingState();
    return true;
  }, [isAnyVaultStructuralOperationPending, isAuthoritativeSyncActive, refreshStructuralPendingState]);

  const releaseVaultStructuralOperation = useCallback((entityKey: string) => {
    // Once runTrackedOperation has adopted the reservation, it owns cleanup
    // after the durable journal entry succeeds or is replayed.
    if (trackedOperationsRef.current.get(entityKey)?.durable) return;
    reservedStructuralEntityKeysRef.current.delete(entityKey);
    refreshStructuralPendingState();
  }, [refreshStructuralPendingState]);

  const prepareVaultStructuralOperations = useCallback(async (
    operations: readonly VaultPendingOperation[],
  ) => {
    if (disconnectingRef.current) throw new Error('Vault is disconnecting.');
    const vaultId = vaultIdRef.current;
    if (!vaultId) throw new Error('Vault identity is not ready.');
    const prepared = operations.map((operation) => ({
      ...operation,
      vaultId,
      phase: 'prepared' as const,
    }));
    await storage.upsertVaultPendingOperations(prepared);
    prepared.forEach((operation) => pendingStructuralEntityKeysRef.current.add(operation.entityKey));
    refreshStructuralPendingState();
  }, [refreshStructuralPendingState]);

  const cancelVaultStructuralOperations = useCallback(async (
    operations: readonly VaultPendingOperation[],
  ) => {
    await Promise.all(operations.map((operation) => storage.removeVaultPendingOperation(operation.key)));
    operations.forEach((operation) => {
      pendingStructuralEntityKeysRef.current.delete(operation.entityKey);
      reservedStructuralEntityKeysRef.current.delete(operation.entityKey);
      trackedOperationsRef.current.delete(operation.entityKey);
    });
    refreshStructuralPendingState();
  }, [refreshStructuralPendingState]);

  const cancelDisconnect = useCallback(() => {
    disconnectingRef.current = false;
    for (const [key, operation] of trackedOperationsRef.current) {
      if (!operation.failed) trackedOperationsRef.current.delete(key);
    }
    refreshStructuralPendingState();
    recordSuccess();
  }, [recordSuccess, refreshStructuralPendingState]);

  const disconnect = useCallback(async () => {
    if (!disconnectingRef.current) beginDisconnect();
    await disconnectDirectory();
    trackedOperationsRef.current.clear();
    reservedStructuralEntityKeysRef.current.clear();
    pendingStructuralEntityKeysRef.current.clear();
    refreshStructuralPendingState();
    resetVaultStatSnapshot();
    resetRetryState();
    setFsHandle(null);
    setSyncStatus('idle');
    setFsSyncError(null);
    setNeedsReauth(false);
    setAutoRetryExhausted(false);
    setVaultHydrated(true);
    setVaultHydrationPending(false);
    disconnectingRef.current = false;
  }, [beginDisconnect, refreshStructuralPendingState, resetRetryState]);

  const syncNoteOnUpdate = useCallback(
    (id: string, content: string) => {
      if (!fsHandle) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note) return;
      // Mirror mode: only vault-origin notes write through to disk. Noa-owned
      // notes live purely in IndexedDB and never touch the vault.
      if (note.origin !== 'vault') return;

      runTrackedOperation(
        `note:${id}`,
        () => syncNoteUpdate(fsHandle, note, content, foldersRef.current),
        { id, content },
      );
    },
    [fsHandle, runTrackedOperation],
  );

  const syncNoteOnMove = useCallback(
    (note: Note, nextFolderId: string) => {
      if (!fsHandle) return;
      if (note.origin !== 'vault') return;
      if (nextFolderId) {
        const nextFolder = foldersRef.current.find((folder) => folder.id === nextFolderId);
        if (nextFolder?.origin !== 'vault') return;
      }
      const previousNote = { ...note };
      const movedNote = { ...note, folder: nextFolderId, updatedAt: new Date().toISOString() };
      runTrackedOperation(
        `note:${note.id}`,
        () => syncNoteMove(fsHandle, previousNote, movedNote, foldersRef.current),
        { id: note.id, folder: nextFolderId },
      );
    },
    [fsHandle, runTrackedOperation],
  );

  const syncNoteOnRename = useCallback(
    (note: Note, newTitle: string) => {
      if (!fsHandle) return;
      if (note.origin !== 'vault') return;

      runTrackedOperation(
        `note:${note.id}`,
        () => syncNoteRename(fsHandle, note, newTitle, foldersRef.current),
        { id: note.id, title: newTitle },
      );
    },
    [fsHandle, runTrackedOperation],
  );

  const syncNoteOnDelete = useCallback(
    (note: Note, prepared?: VaultPendingOperation) => {
      if (!fsHandle) return;
      if (note.origin !== 'vault') return;

      const entityKey = `note:${note.id}`;
      const currentFolders = foldersRef.current;
      runTrackedOperation(
        entityKey,
        () => syncNoteDelete(fsHandle, note, currentFolders),
        undefined,
        prepared ?? {
          key: `${entityKey}:delete:${crypto.randomUUID()}`,
          entityKey,
          kind: 'delete-note',
          note,
          folders: currentFolders,
        },
      );
    },
    [fsHandle, runTrackedOperation],
  );

  const syncFolderOnDelete = useCallback(
    (folder: Folder, prepared?: VaultPendingOperation) => {
      if (!fsHandle || folder.origin !== 'vault') return;
      const entityKey = `folder:${folder.id}`;
      runTrackedOperation(
        entityKey,
        () => syncFolderDelete(fsHandle, folder.name),
        undefined,
        prepared ?? {
          key: `${entityKey}:delete:${crypto.randomUUID()}`,
          entityKey,
          kind: 'delete-folder',
          folder,
        },
      );
    },
    [fsHandle, runTrackedOperation],
  );

  const syncFolderOnRename = useCallback(
    (folderId: string, previousName: string, nextFolders: Folder[], prepared?: VaultPendingOperation) => {
      if (!fsHandle) return;
      const targetFolder = foldersRef.current.find((folder) => folder.id === folderId);
      if (!targetFolder) return;
      // Mirror mode: renaming a Noa-owned folder must not create or move any
      // directories in the vault.
      if (targetFolder.origin !== 'vault') return;
      const entityKey = `folder:${folderId}`;
      runTrackedOperation(
        entityKey,
        () => syncFolderRename(fsHandle, folderId, previousName, nextFolders, notesRef.current),
        undefined,
        prepared ?? {
          key: `${entityKey}:rename:${crypto.randomUUID()}`,
          entityKey,
          kind: 'rename-folder',
          folderId,
          previousName,
          nextFolders,
        },
      );
    },
    [fsHandle, runTrackedOperation],
  );

  return {
    fsHandle,
    syncStatus,
    fsLastSyncAt,
    fsSyncError,
    permissionRevoked,
    needsReauth,
    autoRetryExhausted,
    vaultCacheReadOnly,
    authoritativeSyncInProgress,
    isAuthoritativeSyncActive,
    isVaultEntityOperationPending,
    isAnyVaultStructuralOperationPending,
    reserveVaultStructuralOperation,
    releaseVaultStructuralOperation,
    prepareVaultStructuralOperations,
    cancelVaultStructuralOperations,
    hasPendingStructuralOperations,
    connect,
    beginDisconnect,
    cancelDisconnect,
    disconnect,
    retry,
    reconnect,
    syncNoteOnUpdate,
    syncNoteOnMove,
    syncNoteOnRename,
    syncFolderOnRename,
    syncFolderOnDelete,
    syncNoteOnDelete,
    externalUpdateNotice,
  };
}
