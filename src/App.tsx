/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from './constants/storageKeys';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import { useGlobalTasks } from './hooks/useGlobalTasks';
import { useSettings } from './hooks/useSettings';
import { useNotes } from './hooks/useNotes';
import { useLayout } from './hooks/useLayout';
import { useFileSync } from './hooks/useFileSync';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useAutoBackup } from './hooks/useAutoBackup';
import { useCommandPalette } from './hooks/useCommandPalette';
import { useGlobalScrollingClass } from './hooks/useScrollingClass';
import ThemeInjector from './components/ThemeInjector';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LOCAL_DATA_BOUNDARY_COPY } from './lib/userFacingCopy';
import { deleteNoteWithLocalFirst } from './lib/deleteFlow';
import { isDescendantPath } from './lib/pathUtils';
import { builtinTemplates, applyTemplate } from './lib/templates';
import type { VaultPendingOperation } from './types';

const Editor = lazy(() => import('./components/Editor'));
const RightPanel = lazy(() => import('./components/RightPanel'));
const SettingsModal = lazy(() => import('./components/settings/SettingsModal'));

const OPEN_TABS_KEY = STORAGE_KEYS.OPEN_TABS;
const MAX_OPEN_TABS = 20;

export default function App() {
  useGlobalScrollingClass();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const recoveryImportInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [enteringTabId, setEnteringTabId] = useState<string | null>(null);
  const [enteringFromTabId, setEnteringFromTabId] = useState<string | null>(null);
  const [closingTabIds, setClosingTabIds] = useState<Set<string>>(() => new Set());
  const [tabLimitWarning, setTabLimitWarning] = useState(false);
  const restoredOpenTabsRef = useRef(false);
  const openTabIdsRef = useRef<string[]>([]);
  const activeNoteIdRef = useRef('');
  const enteringTabIdRef = useRef<string | null>(null);
  const enteringTabResetRef = useRef<number | null>(null);
  const closingTabTimeoutsRef = useRef<Map<string, number>>(new Map());
  const tabLimitWarningTimeoutRef = useRef<number | null>(null);
  const [showStorageNotice, setShowStorageNotice] = useState(() => {
    try {
      return !localStorage.getItem(STORAGE_KEYS.STORAGE_NOTICE_SEEN);
    } catch {
      return true;
    }
  });
  const [navigationConflict, setNavigationConflict] = useState<{ title: string; noteIds: string[] } | null>(null);
  const [pendingTemplateNoteId, setPendingTemplateNoteId] = useState<string | null>(null);
  const waitingForTemplateRef = useRef(false);
  const { settings, updateSettings } = useSettings();
  const {
    notes,
    folders,
    workspaceName,
    activeNoteId,
    setActiveNoteId,
    recentNoteIds,
    handleUpdateNote: _handleUpdateNote,
    handleSaveNote,
    handleRenameNote: _handleRenameNote,
    handleCreateNote: _handleCreateNote,
    handleMoveNote: _handleMoveNote,
    handleImportNote,
    handleNavigateToNote,
    handleNavigateToNoteById,
    handleDeleteNote: _handleDeleteNote,
    handleCreateFolder: _handleCreateFolder,
    handleRenameFolder: _handleRenameFolder,
    handleDeleteFolder: _handleDeleteFolder,
    handleOpenDailyNote,
    handleToggleTask,
    handleImportData,
    getIsImporting,
    restoreSnapshot,
    loadError,
    saveError,
    setSaveError,
    clearSaveError,
    flushAllPendingSaves,
    retryInitialization,
    resetWorkspaceFromRecovery,
    clearWorkspaceAfterDisconnect,
    importBackupFromRecovery,
    markVaultNotesSynced,
    isLoaded,
    setWorkspaceName,
  } = useNotes(settings);

  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { activeNoteIdRef.current = activeNoteId; }, [activeNoteId]);

  const ensureInitialNote = useCallback(() => handleOpenDailyNote(), [handleOpenDailyNote]);
  const {
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
  } = useFileSync({
    isLoaded,
    notes,
    folders,
    workspaceName,
    activeNoteId,
    ensureInitialNote,
    onImportData: handleImportData,
    onVaultNotesSynced: markVaultNotesSynced,
  });

  const blockVaultCacheWrite = useCallback((isVaultOwned: boolean) => {
    const authoritativeSyncActive = isAuthoritativeSyncActive();
    const structuralOperationPending = isAnyVaultStructuralOperationPending();
    if (!isVaultOwned || (!vaultCacheReadOnly && !authoritativeSyncActive && !structuralOperationPending)) return false;
    setSaveError(structuralOperationPending
      ? 'A vault file operation is still pending. Retry sync before making more changes.'
      : authoritativeSyncActive
        ? 'Vault changes are being applied from disk. Wait for sync to finish before editing.'
        : 'Vault is the source of truth. Reconnect or retry sync before making changes.');
    return true;
  }, [isAnyVaultStructuralOperationPending, isAuthoritativeSyncActive, setSaveError, vaultCacheReadOnly]);

  const blockPendingVaultEntityOperation = useCallback((entityKey: string) => {
    if (!isVaultEntityOperationPending(entityKey)) return false;
    setSaveError('A vault file operation is still pending for this item. Retry sync before changing it again.');
    return true;
  }, [isVaultEntityOperationPending, setSaveError]);

  const autoBackup = useAutoBackup({
    notes,
    folders,
    workspaceName,
    isLoaded,
    autoBackupEnabled: settings.backup?.autoBackupEnabled ?? false,
    onSettingsUpdate: useCallback((patch: { autoBackupEnabled: boolean }) => {
      updateSettings((prev) => ({
        ...prev,
        backup: { ...prev.backup, autoBackupEnabled: patch.autoBackupEnabled },
      }));
    }, [updateSettings]),
    getIsImporting,
  });

  // If the app loads with no vault connected but a stale workspace name
  // (left over from a previous vault session), reset it to the default.
  // We wait for syncStatus === 'idle' to confirm bootstrap has completed
  // and there is genuinely no persisted vault handle.
  // workspaceName and setWorkspaceName are intentionally omitted: we only want
  // this effect to re-evaluate on bootstrap/sync transitions, not when the name
  // itself changes (which would cause the guard below to re-run after the set).
  const workspaceNameRef = useRef(workspaceName);
  useEffect(() => { workspaceNameRef.current = workspaceName; }, [workspaceName]);
  const setWorkspaceNameRef = useRef(setWorkspaceName);
  useEffect(() => { setWorkspaceNameRef.current = setWorkspaceName; }, [setWorkspaceName]);
  useEffect(() => {
    if (!isLoaded) return;
    if (fsHandle !== null) return;
    if (syncStatus !== 'idle') return;
    if (workspaceNameRef.current === 'Default Workspace') return;
    setWorkspaceNameRef.current('Default Workspace');
  }, [isLoaded, fsHandle, syncStatus]);

  const handleUpdateNote = useCallback((id: string, content: string) => {
    const note = notesRef.current.find((item) => item.id === id);
    if (blockVaultCacheWrite(note?.origin === 'vault')) return;
    _handleUpdateNote(id, content);
    syncNoteOnUpdate(id, content);
  }, [_handleUpdateNote, blockVaultCacheWrite, syncNoteOnUpdate]);

  const handleRenameNote = useCallback((id: string, newTitle: string) => {
    const note = notesRef.current.find((item) => item.id === id);
    if (blockVaultCacheWrite(note?.origin === 'vault')) return;
    if (!note) return;
    _handleRenameNote(id, newTitle);
    syncNoteOnRename(note, newTitle);
  }, [_handleRenameNote, blockVaultCacheWrite, syncNoteOnRename]);

  const handleCreateNote = useCallback((folderId: string, initialContent?: string) => {
    const targetFolder = folders.find((folder) => folder.id === folderId);
    if (blockVaultCacheWrite(targetFolder?.origin === 'vault')) return '';
    const createdId = _handleCreateNote(folderId, initialContent);
    // New note will be saved by useNotes via storage.saveNote; FS sync on next update
    const userTemplates = settings.templates?.userTemplates ?? [];
    if (createdId && userTemplates.length > 0 && !initialContent) {
      waitingForTemplateRef.current = true;
    }
    return createdId;
  }, [_handleCreateNote, blockVaultCacheWrite, folders, settings.templates?.userTemplates]);

  const handleSaveNoteGuarded = useCallback((note: Parameters<typeof handleSaveNote>[0]) => {
    if (blockVaultCacheWrite(note.origin === 'vault')) return;
    handleSaveNote(note);
  }, [blockVaultCacheWrite, handleSaveNote]);

  const handleImportNoteGuarded = useCallback((...args: Parameters<typeof handleImportNote>) => {
    const folderId = args[2];
    const targetFolder = folderId ? folders.find((folder) => folder.id === folderId) : undefined;
    if (blockVaultCacheWrite(targetFolder?.origin === 'vault')) return;
    handleImportNote(...args);
  }, [blockVaultCacheWrite, folders, handleImportNote]);

  const handleOpenDailyNoteGuarded = useCallback(() => {
    handleOpenDailyNote();
  }, [handleOpenDailyNote]);

  const handleToggleTaskGuarded = useCallback((task: Parameters<typeof handleToggleTask>[0]) => {
    const note = notesRef.current.find((item) => item.id === task.noteId);
    if (blockVaultCacheWrite(note?.origin === 'vault')) return;
    const toggled = handleToggleTask(task);
    // Write through to the vault — a storage-only toggle would be reverted by
    // the next disk-authoritative scan.
    if (toggled) syncNoteOnUpdate(toggled.noteId, toggled.content);
  }, [blockVaultCacheWrite, handleToggleTask, syncNoteOnUpdate]);

  const restoreSnapshotGuarded = useCallback(async (snapshot: Parameters<typeof restoreSnapshot>[0]) => {
    const note = notesRef.current.find((item) => item.id === snapshot.noteId);
    if (blockVaultCacheWrite(note?.origin === 'vault')) return;
    await restoreSnapshot(snapshot);
    // Write through to the vault — a storage-only restore would be reverted by
    // the next disk-authoritative scan.
    syncNoteOnUpdate(snapshot.noteId, snapshot.content);
  }, [blockVaultCacheWrite, restoreSnapshot, syncNoteOnUpdate]);

  const handleMoveNote = useCallback((id: string, folderId: string) => {
    const note = notesRef.current.find((item) => item.id === id);
    if (!note || note.folder === folderId) return;
    if (blockVaultCacheWrite(note.origin === 'vault')) return;
    _handleMoveNote(id, folderId);
    syncNoteOnMove(note, folderId);
  }, [_handleMoveNote, blockVaultCacheWrite, syncNoteOnMove]);

  const handleCreateFolder = useCallback((parentFolderId?: string) => {
    const parentFolder = parentFolderId ? folders.find((folder) => folder.id === parentFolderId) : undefined;
    if (blockVaultCacheWrite(parentFolder?.origin === 'vault')) return;
    _handleCreateFolder(parentFolderId);
  }, [_handleCreateFolder, blockVaultCacheWrite, folders]);

  const handleRenameFolder = useCallback((id: string, newName: string) => {
    const oldFolder = folders.find((folder) => folder.id === id);
    if (!oldFolder) return;
    if (blockVaultCacheWrite(oldFolder.origin === 'vault')) return;
    const entityKey = `folder:${id}`;
    const needsVaultReservation = oldFolder.origin === 'vault';
    if (needsVaultReservation && blockPendingVaultEntityOperation(entityKey)) return;
    if (needsVaultReservation && !reserveVaultStructuralOperation(entityKey)) {
      setSaveError('A vault file operation is still pending. Retry sync before changing this folder.');
      return;
    }
    const previousName = oldFolder.name;
    const nextName = newName.trim() || 'Untitled Folder';
    const targetIsVault = oldFolder.origin === 'vault';
    const nextFolders = folders.map((folder) => {
      if (folder.id === id) return { ...folder, name: nextName };
      if ((folder.origin === 'vault') === targetIsVault && isDescendantPath(folder.name, previousName)) {
        return { ...folder, name: nextName + folder.name.slice(previousName.length) };
      }
      return folder;
    });

    if (!needsVaultReservation) {
      void _handleRenameFolder(id, newName).catch(() => {});
      return;
    }

    const operation: VaultPendingOperation = {
      key: `${entityKey}:rename:${crypto.randomUUID()}`,
      entityKey,
      kind: 'rename-folder',
      phase: 'prepared',
      folderId: id,
      previousName,
      nextFolders,
    };
    void (async () => {
      try {
        await prepareVaultStructuralOperations([operation]);
        await _handleRenameFolder(id, newName);
        syncFolderOnRename(id, previousName, nextFolders, operation);
      } catch (error) {
        await cancelVaultStructuralOperations([operation]).catch(() => {
          releaseVaultStructuralOperation(entityKey);
        });
        setSaveError(error instanceof Error ? error.message : 'Failed to prepare the vault folder rename.');
      }
    })();
  }, [_handleRenameFolder, blockPendingVaultEntityOperation, blockVaultCacheWrite, cancelVaultStructuralOperations, folders, prepareVaultStructuralOperations, releaseVaultStructuralOperation, reserveVaultStructuralOperation, setSaveError, syncFolderOnRename]);

  const closeTabById = useCallback((id: string) => {
    const current = openTabIdsRef.current;
    const idx = current.indexOf(id);
    if (idx === -1) {
      setClosingTabIds((prev) => {
        if (!prev.has(id)) return prev;
        const nextClosing = new Set(prev);
        nextClosing.delete(id);
        return nextClosing;
      });
      return;
    }

    const closeTimeout = closingTabTimeoutsRef.current.get(id);
    if (closeTimeout !== undefined) {
      window.clearTimeout(closeTimeout);
      closingTabTimeoutsRef.current.delete(id);
    }

    const next = current.filter(t => t !== id);
    openTabIdsRef.current = next;
    setClosingTabIds((prev) => {
      if (!prev.has(id)) return prev;
      const nextClosing = new Set(prev);
      nextClosing.delete(id);
      return nextClosing;
    });
    setOpenTabIds(next);
    if (id === activeNoteIdRef.current) {
      if (next.length === 0) {
        setActiveNoteId('');
      } else {
        // Prefer the tab to the right; fall back to the one to the left
        const nextActive = next[idx] ?? next[idx - 1];
        setActiveNoteId(nextActive);
      }
    }
  }, [setActiveNoteId]);

  const handleDeleteNote = useCallback((id: string) => {
    const note = notesRef.current.find((item) => item.id === id);
    if (blockVaultCacheWrite(note?.origin === 'vault')) return;
    if (!note) return;
    const entityKey = `note:${note.id}`;
    const needsVaultReservation = note.origin === 'vault';
    if (needsVaultReservation && blockPendingVaultEntityOperation(entityKey)) return;
    if (needsVaultReservation && !reserveVaultStructuralOperation(entityKey)) {
      setSaveError('A vault file operation is still pending. Retry sync before deleting this note.');
      return;
    }
    const operation: VaultPendingOperation | undefined = needsVaultReservation ? {
      key: `${entityKey}:delete:${crypto.randomUUID()}`,
      entityKey,
      kind: 'delete-note',
      phase: 'prepared',
      note,
      folders: folders.filter((folder) => folder.origin === 'vault'),
    } : undefined;
    void (async () => {
      try {
        if (operation) await prepareVaultStructuralOperations([operation]);
        const deleted = await deleteNoteWithLocalFirst({
          id,
          deleteLocal: _handleDeleteNote,
          closeTab: closeTabById,
          syncDelete: () => syncNoteOnDelete(note, operation),
        });
        if (!deleted && operation) await cancelVaultStructuralOperations([operation]);
      } catch (error) {
        if (operation) {
          await cancelVaultStructuralOperations([operation]).catch(() => {
            releaseVaultStructuralOperation(entityKey);
          });
        }
        console.error('[App] handleDeleteNote failed:', error);
        setSaveError(error instanceof Error ? error.message : 'Failed to prepare the vault note delete.');
      }
    })();
  }, [_handleDeleteNote, blockPendingVaultEntityOperation, blockVaultCacheWrite, cancelVaultStructuralOperations, closeTabById, folders, prepareVaultStructuralOperations, releaseVaultStructuralOperation, reserveVaultStructuralOperation, setSaveError, syncNoteOnDelete]);

  const handleDeleteFolder = useCallback((id: string) => {
    const deletedFolder = folders.find((folder) => folder.id === id);
    if (blockVaultCacheWrite(deletedFolder?.origin === 'vault')) return;
    const entityKey = `folder:${id}`;
    const needsVaultReservation = deletedFolder?.origin === 'vault';
    if (needsVaultReservation && blockPendingVaultEntityOperation(entityKey)) return;
    if (needsVaultReservation && !reserveVaultStructuralOperation(entityKey)) {
      setSaveError('A vault file operation is still pending. Retry sync before deleting this folder.');
      return;
    }
    const notesBeforeDelete = new Map(notesRef.current.map((note) => [note.id, note]));
    const targetIsVault = deletedFolder?.origin === 'vault';
    const folderIdsToDelete = new Set(
      folders
        .filter((folder) => (
          folder.id === id
          || ((folder.origin === 'vault') === targetIsVault
            && isDescendantPath(folder.name, deletedFolder?.name ?? ''))
        ))
        .map((folder) => folder.id),
    );
    const candidateNotes = Array.from(notesBeforeDelete.values()).filter(
      (note) => note.origin === 'vault' && folderIdsToDelete.has(note.folder),
    );
    const noteOperations = new Map(candidateNotes.map((note) => {
      const noteEntityKey = `note:${note.id}`;
      const operation: VaultPendingOperation = {
        key: `${noteEntityKey}:delete:${crypto.randomUUID()}`,
        entityKey: noteEntityKey,
        kind: 'delete-note',
        phase: 'prepared',
        note,
        folders: folders.filter((folder) => folder.origin === 'vault'),
      };
      return [note.id, operation] as const;
    }));
    const folderOperation: VaultPendingOperation | undefined = deletedFolder?.origin === 'vault' ? {
      key: `${entityKey}:delete:${crypto.randomUUID()}`,
      entityKey,
      kind: 'delete-folder',
      phase: 'prepared',
      folder: deletedFolder,
    } : undefined;
    const preparedOperations = [
      ...noteOperations.values(),
      ...(folderOperation ? [folderOperation] : []),
    ];
    const handedOffOperationKeys = new Set<string>();
    void (async () => {
      try {
        if (preparedOperations.length > 0) await prepareVaultStructuralOperations(preparedOperations);
        const { deletedNoteIds, foldersDeleted } = await _handleDeleteFolder(id);
        const deletedSet = new Set(deletedNoteIds);
        deletedNoteIds.forEach((noteId) => closeTabById(noteId));
        deletedNoteIds.forEach((noteId) => {
          const deletedNote = notesBeforeDelete.get(noteId);
          const operation = noteOperations.get(noteId);
          if (deletedNote && operation) {
            syncNoteOnDelete(deletedNote, operation);
            handedOffOperationKeys.add(operation.key);
          }
        });
        const canceledOperations: VaultPendingOperation[] = candidateNotes
          .filter((note) => !deletedSet.has(note.id))
          .flatMap((note) => noteOperations.get(note.id) ?? []);
        // Mirror mode: only a vault folder has a directory on disk to remove.
        // A Noa-owned folder never touched the vault, and its name could match
        // an unrelated vault directory — so never run the disk cleanup for it.
        if (deletedFolder && folderOperation && foldersDeleted) {
          syncFolderOnDelete(deletedFolder, folderOperation);
          handedOffOperationKeys.add(folderOperation.key);
        } else if (folderOperation) {
          canceledOperations.push(folderOperation);
        }
        if (canceledOperations.length > 0) await cancelVaultStructuralOperations(canceledOperations);
      } catch (err) {
        const unclaimedOperations = preparedOperations.filter(
          (operation) => !handedOffOperationKeys.has(operation.key),
        );
        if (unclaimedOperations.length > 0) {
          await cancelVaultStructuralOperations(unclaimedOperations).catch(() => {
            if (needsVaultReservation) releaseVaultStructuralOperation(entityKey);
          });
        } else if (needsVaultReservation) {
          releaseVaultStructuralOperation(entityKey);
        }
        console.error('[App] handleDeleteFolder failed:', err);
        setSaveError(err instanceof Error ? err.message : 'Failed to prepare the vault folder delete.');
      }
    })();
  }, [_handleDeleteFolder, blockPendingVaultEntityOperation, blockVaultCacheWrite, cancelVaultStructuralOperations, closeTabById, folders, prepareVaultStructuralOperations, releaseVaultStructuralOperation, reserveVaultStructuralOperation, setSaveError, syncFolderOnDelete, syncNoteOnDelete]);

  const handleDisconnectFolder = useCallback(async () => {
    let disconnectStarted = false;
    try {
      if (notesRef.current.some((note) => note.origin === 'vault' && note.vaultDirty)) {
        throw new Error('Some vault edits have not reached disk yet. Retry sync before disconnecting.');
      }
      if (hasPendingStructuralOperations) {
        throw new Error('Vault file operations are still pending. Retry sync before disconnecting.');
      }
      beginDisconnect();
      disconnectStarted = true;
      const deletedNoteIds = await clearWorkspaceAfterDisconnect();
      deletedNoteIds.forEach((id) => closeTabById(id));
      await disconnect();
    } catch (err) {
      if (disconnectStarted) cancelDisconnect();
      console.error('[App] handleDisconnectFolder failed:', err);
      setSaveError(err instanceof Error
        ? err.message
        : 'Failed to disconnect vault. Check folder permissions and retry.');
      throw err;
    }
  }, [beginDisconnect, cancelDisconnect, disconnect, clearWorkspaceAfterDisconnect, closeTabById, hasPendingStructuralOperations, setSaveError]);

  const {
    isMobile,
    isSidebarOpen,
    setIsSidebarOpen,
    isRightPanelOpen,
    setIsRightPanelOpen,
    activeRightTab,
    setActiveRightTab,
    isDraggingSidebar,
    isDraggingRightPanel,
    setIsDraggingSidebar,
    setIsDraggingRightPanel,
    editorViewMode,
    setEditorViewMode,
    isFocusMode,
    toggleFocusMode,
    exitFocusMode,
  } = useLayout();

  // Keep the graph/tasks bundle out of the first render. If the panel was
  // restored as open, mount it on the next frame so the app shell can paint
  // first. Once mounted, retain it across toggles to preserve panel state and
  // make subsequent opens instantaneous.
  const [hasMountedRightPanel, setHasMountedRightPanel] = useState(false);
  useEffect(() => {
    if (!isLoaded || !isRightPanelOpen || hasMountedRightPanel) return;
    const frame = window.requestAnimationFrame(() => setHasMountedRightPanel(true));
    return () => window.cancelAnimationFrame(frame);
  }, [hasMountedRightPanel, isLoaded, isRightPanelOpen]);

  // Restore openTabIds from localStorage after notes load
  useEffect(() => {
    if (!isLoaded || restoredOpenTabsRef.current) return;
    restoredOpenTabsRef.current = true;
    let saved: string | null = null;
    try { saved = localStorage.getItem(OPEN_TABS_KEY); } catch { /* quota exceeded */ }
    if (!saved) return;
    try {
      const ids: string[] = JSON.parse(saved);
      const validIds = ids.filter(id => notes.some(n => n.id === id)).slice(-MAX_OPEN_TABS);
      if (validIds.length > 0) {
        openTabIdsRef.current = validIds;
        setOpenTabIds(validIds);
      }
    } catch { /* ignore */ }
  }, [isLoaded, notes]);

  // Persist openTabIds to localStorage (debounced — tabs open/close rapidly)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openTabIds));
      } catch { /* quota exceeded — ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [openTabIds]);

  // Keep openTabIdsRef in sync for use in other effects
  useEffect(() => {
    openTabIdsRef.current = openTabIds;
  }, [openTabIds]);

  // Warm the lazy settings chunk while idle so the first open doesn't spend a
  // beat fetching it before anything renders (its Suspense fallback is null).
  useEffect(() => {
    if (typeof window.requestIdleCallback !== 'function') return;
    const id = window.requestIdleCallback(
      () => { void import('./components/settings/SettingsModal'); },
      { timeout: 5000 }
    );
    return () => window.cancelIdleCallback(id);
  }, []);

  const showTabLimitWarning = useCallback(() => {
    setTabLimitWarning(true);
    if (tabLimitWarningTimeoutRef.current !== null) {
      window.clearTimeout(tabLimitWarningTimeoutRef.current);
    }
    tabLimitWarningTimeoutRef.current = window.setTimeout(() => {
      setTabLimitWarning(false);
      tabLimitWarningTimeoutRef.current = null;
    }, 3000);
  }, []);

  const markEnteringTab = useCallback((id: string, fromId: string | null) => {
    enteringTabIdRef.current = id;
    setEnteringTabId(id);
    setEnteringFromTabId(fromId);
    if (enteringTabResetRef.current !== null) {
      window.clearTimeout(enteringTabResetRef.current);
    }
    enteringTabResetRef.current = window.setTimeout(() => {
      if (enteringTabIdRef.current === id) {
        enteringTabIdRef.current = null;
        setEnteringTabId(null);
        setEnteringFromTabId(null);
      }
      if (enteringTabResetRef.current !== null) {
        enteringTabResetRef.current = null;
      }
    }, 190);
  }, []);

  const openTabForNote = useCallback((id: string, animate: boolean) => {
    const wasOpen = openTabIdsRef.current.includes(id);
    const hadTabs = openTabIdsRef.current.length > 0;
    if (!wasOpen && openTabIdsRef.current.length >= MAX_OPEN_TABS) {
      showTabLimitWarning();
    }
    setOpenTabIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = prev.length < MAX_OPEN_TABS
        ? [...prev, id]
        : (() => {
            const dropIndex = prev.findIndex((tabId) => tabId !== id);
            if (dropIndex === -1) return [id];
            return [...prev.slice(0, dropIndex), ...prev.slice(dropIndex + 1), id];
          })();
      openTabIdsRef.current = next;
      return next;
    });
    if (animate && !wasOpen && hadTabs) {
      markEnteringTab(id, activeNoteIdRef.current || null);
    }
  }, [markEnteringTab, showTabLimitWarning]);

  useEffect(() => () => {
    if (enteringTabResetRef.current !== null) {
      window.clearTimeout(enteringTabResetRef.current);
    }
    if (tabLimitWarningTimeoutRef.current !== null) {
      window.clearTimeout(tabLimitWarningTimeoutRef.current);
    }
    closingTabTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    closingTabTimeoutsRef.current.clear();
  }, []);

  // Sync activeNoteId into openTabIds. Animate: openTabForNote only marks the
  // tab as entering when it's genuinely new and other tabs already exist, so
  // sidebar/search-opened notes get the same entrance as the "+" button.
  useEffect(() => {
    if (!activeNoteId) return;
    openTabForNote(activeNoteId, true);
  }, [activeNoteId, openTabForNote]);

  // When a note is created with waitingForTemplateRef set, pop the template picker
  useEffect(() => {
    if (waitingForTemplateRef.current && activeNoteId) {
      waitingForTemplateRef.current = false;
      setPendingTemplateNoteId(activeNoteId);
    }
  }, [activeNoteId]);

  const primaryNoaFolderId = useMemo(
    () => folders.find((f) => f.origin !== 'vault' && (f.source ?? 'noa') === 'noa')?.id ?? 'diary',
    [folders]
  );

  const handleTabChange = useCallback((id: string) => {
    if (id === activeNoteId) return;
    // Switch immediately, then persist the outgoing note's pending edits in the
    // background. The debounce-save timers in useNotes are independent of the
    // editor unmount, so nothing is lost by not awaiting — and awaiting an
    // IndexedDB write here is what made tab switches stutter whenever a save
    // was still pending (i.e. right after typing).
    setActiveNoteId(id);
    void flushAllPendingSaves().catch(err => {
      console.error('[Noa] Failed to flush saves on tab change:', err);
    });
  }, [activeNoteId, setActiveNoteId, flushAllPendingSaves]);

  const handleTabClose = useCallback((id: string) => {
    const current = openTabIdsRef.current;
    const idx = current.indexOf(id);
    if (idx === -1 || closingTabIds.has(id)) return;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      closeTabById(id);
      return;
    }

    const next = current.filter(t => t !== id);
    if (id === activeNoteIdRef.current && next.length > 0) {
      const nextActive = next[idx] ?? next[idx - 1];
      setActiveNoteId(nextActive);
    }

    setClosingTabIds((prev) => {
      if (prev.has(id)) return prev;
      const nextClosing = new Set(prev);
      nextClosing.add(id);
      return nextClosing;
    });

    const timeoutId = window.setTimeout(() => {
      closingTabTimeoutsRef.current.delete(id);
      closeTabById(id);
    }, 220);
    closingTabTimeoutsRef.current.set(id, timeoutId);
  }, [closeTabById, closingTabIds, setActiveNoteId]);

  const handleTabCloseAnimationComplete = useCallback((id: string) => {
    closeTabById(id);
  }, [closeTabById]);

  const handleNewTab = useCallback(() => {
    const createdId = handleCreateNote(primaryNoaFolderId);
    if (createdId) openTabForNote(createdId, true);
  }, [primaryNoaFolderId, handleCreateNote, openTabForNote]);

  const handleTabEnterComplete = useCallback((id: string) => {
    if (enteringTabIdRef.current !== id) return;
    enteringTabIdRef.current = null;
    if (enteringTabResetRef.current !== null) {
      window.clearTimeout(enteringTabResetRef.current);
      enteringTabResetRef.current = null;
    }
    setEnteringTabId(null);
    setEnteringFromTabId(null);
  }, []);

  const openTabs = useMemo(() => {
    const noteById = new Map(notes.map(n => [n.id, n]));
    return openTabIds.flatMap(id => {
      const n = noteById.get(id);
      return n ? [{ id: n.id, title: n.title }] : [];
    });
  }, [openTabIds, notes]);

  const globalTasks = useGlobalTasks(notes);
  const activeNote = useMemo(() => activeNoteId ? notes.find(n => n.id === activeNoteId) : undefined, [activeNoteId, notes]);

  // Detect orphan activeNoteId: the note was deleted in another tab/window.
  // Without this, Editor.onUpdate fires into a null target and edits are
  // silently dropped. Clear the selection and surface a toast.
  useEffect(() => {
    if (!isLoaded) return;
    if (activeNoteId && !activeNote) {
      setSaveError('The active note was removed. Recent input was not saved.');
      setActiveNoteId('');
    }
  }, [isLoaded, activeNoteId, activeNote, setActiveNoteId, setSaveError]);
  const folderNameById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.name])), [folders]);

  // Read notes via ref so these callbacks stay referentially stable across
  // keystrokes — they feed memoized children (Sidebar rows, TasksPanel).
  const navigateById = useCallback((id: string) => {
    if (!notesRef.current.some((note) => note.id === id)) return;
    handleNavigateToNoteById(id);
  }, [handleNavigateToNoteById]);

  const navigateByTitle = useCallback((title: string) => {
    const matched = notesRef.current.filter((note) => note.title === title);
    if (matched.length === 1) {
      navigateById(matched[0].id);
      return;
    }
    if (matched.length === 0) {
      handleNavigateToNote(title);
      return;
    }
    setNavigationConflict({ title, noteIds: matched.map((note) => note.id) });
  }, [handleNavigateToNote, navigateById]);

  const handleRightPanelNavigate = useCallback((id: string) => {
    navigateById(id);
    if (isMobile) setIsRightPanelOpen(false);
  }, [navigateById, isMobile, setIsRightPanelOpen]);

  const handleSidebarSelectNote = useCallback((id: string) => {
    // Switch + arm the entrance synchronously so the editor build and tab
    // animation aren't gated on an IndexedDB write; flush the outgoing note's
    // pending saves in the background (timers are independent of unmount, so
    // nothing is lost).
    openTabForNote(id, true);
    setActiveNoteId(id);
    if (isMobile) setIsSidebarOpen(false);
    void flushAllPendingSaves().catch(err => {
      console.error('[Noa] Failed to flush saves on note select:', err);
    });
  }, [openTabForNote, setActiveNoteId, isMobile, setIsSidebarOpen, flushAllPendingSaves]);

  const commandPalette = useCommandPalette({
    notes,
    onCreateNote: () => handleCreateNote(primaryNoaFolderId),
    onOpenDailyNote: handleOpenDailyNoteGuarded,
    onOpenSettings: () => setIsSettingsOpen(true),
    onFocusSearch: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    onOpenNoteById: (id) => navigateById(id),
  });

  // flush pending saves before Electron quits or web page unloads
  useEffect(() => {
    const desktop = window.noaDesktop;
    if (!desktop?.lifecycle?.onBeforeQuit) return;
    return desktop.lifecycle.onBeforeQuit(() => {
      void flushAllPendingSaves();
    });
  }, [flushAllPendingSaves]);
  useEffect(() => {
    const flush = () => { void flushAllPendingSaves(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flushAllPendingSaves]);

  useGlobalShortcuts({
    searchQuery,
    searchInputRef,
    onCreateNote: () => handleCreateNote(primaryNoaFolderId),
    onOpenDailyNote: handleOpenDailyNoteGuarded,
    onOpenCommandPalette: () => commandPalette.setIsOpen(true),
    onFocusSearch: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    onClearSearch: () => setSearchQuery(''),
    onForceSave: () => void flushAllPendingSaves(),
    onToggleFocusMode: toggleFocusMode,
    isFocusMode,
    onExitFocusMode: exitFocusMode,
  });

  if (!isLoaded) {
    return (
      <>
      <ThemeInjector settings={settings} />
      <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-primary, #F9F9F7)' }}>
        <div className="h-12 border-b shrink-0 px-3 flex items-center" style={{ backgroundColor: 'var(--bg-secondary, #EFEAE3)', borderBottomColor: 'var(--panel-divider, #2D2D2B)' }}>
          <div className="h-3 w-44 bg-[#2D2D2B]/10 animate-pulse" />
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-[280px] border-r border-[#2D2D2B]/20 shrink-0 px-3 py-3 space-y-2">
            <div className="h-4 w-28 bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-7 w-full bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-7 w-[90%] bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-7 w-[82%] bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-7 w-[88%] bg-[#2D2D2B]/10 animate-pulse" />
          </div>
          <div className="flex-1 px-6 py-5 space-y-3">
            <div className="h-7 w-48 bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-4 w-full bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-4 w-[97%] bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-4 w-[92%] bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-4 w-[95%] bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-4 w-[85%] bg-[#2D2D2B]/10 animate-pulse" />
          </div>
          <div className="w-[320px] border-l border-[#2D2D2B]/20 shrink-0 px-3 py-3 space-y-2">
            <div className="h-6 w-full bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-10 w-full bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-10 w-full bg-[#2D2D2B]/10 animate-pulse" />
            <div className="h-10 w-full bg-[#2D2D2B]/10 animate-pulse" />
          </div>
        </div>
      </div>
      </>
    );
  }

  return (
    <div className="noa-app-shell h-screen w-screen flex flex-col bg-[#F9F9F7] text-[#2D2D2B] font-redaction overflow-hidden selection:bg-[#CC7D5E] selection:text-white">
      <ThemeInjector settings={settings} />
      {!isFocusMode && <TopBar
        settings={settings}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
        isSidebarOpen={isSidebarOpen}
        isRightPanelOpen={isRightPanelOpen}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showDailyNote={settings.corePlugins.dailyNotes}
        searchInputRef={searchInputRef}
        onOpenDailyNote={handleOpenDailyNoteGuarded}
      />}
      <div className="flex-1 flex overflow-hidden relative">
        {isMobile && isSidebarOpen && (
          <div
            className="absolute inset-0 bg-black/20 z-30"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar — always rendered for slide animation */}
        <div
          className={`flex shrink-0 relative overflow-hidden ${isMobile ? 'absolute inset-y-0 left-0 z-40 bg-[#F9F9F7] shadow-xl' : ''}`}
          style={{
            width: isFocusMode ? '0' : (isMobile ? (isSidebarOpen ? '80%' : '0') : (isSidebarOpen ? 'var(--noa-sidebar-width, 310px)' : '0')),
            maxWidth: isMobile ? '320px' : undefined,
            transition: isDraggingSidebar ? 'none' : 'width 220ms cubic-bezier(0.4, 0, 0.2, 1), border-color 220ms',
            minWidth: 0,
            borderRightWidth: isFocusMode ? 0 : 1,
            borderRightStyle: 'solid',
            borderRightColor: (isSidebarOpen && !isFocusMode) ? 'var(--panel-divider, #2D2D2B)' : 'transparent',
          }}
        >
          <div
            style={{
              width: isMobile ? '80vw' : 'var(--noa-sidebar-width, 310px)',
              maxWidth: isMobile ? '320px' : undefined,
            }}
            className="flex h-full shrink-0"
          >
            <div className="flex-1 overflow-hidden">
              <Sidebar
                notes={notes}
                folders={folders}
                searchQuery={searchQuery}
                activeNoteId={activeNoteId}
                recentNoteIds={recentNoteIds}
                onSelectNote={handleSidebarSelectNote}
                onCreateNote={handleCreateNote}
                onDeleteNote={handleDeleteNote}
                onRenameNote={handleRenameNote}
                onMoveNote={handleMoveNote}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onUpdateNoteContent={handleUpdateNote}
                onOpenDailyNote={handleOpenDailyNoteGuarded}
                onImportNote={handleImportNoteGuarded}
                onSearchTag={(tag) => setSearchQuery(`tag:${tag}`)}
                onClearSearch={() => setSearchQuery('')}
                caseSensitive={settings.search.caseSensitive}
                fuzzySearch={settings.search.fuzzySearch}
                dateFormat={settings.dailyNotes.dateFormat}
              />
            </div>
            {!isMobile && (
              <div
                className="w-1.5 bg-transparent cursor-col-resize absolute right-0 top-0 bottom-0 z-20"
                onMouseDown={() => setIsDraggingSidebar(true)}
              />
            )}
          </div>
        </div>

        <ErrorBoundary>
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-[#2D2D2B]/60 text-sm">Loading editor…</div>}>
            {activeNoteId ? (
              <Editor
                note={activeNote}
                allNotes={notes}
                folders={folders}
                onUpdate={(content) => { if (activeNoteId) handleUpdateNote(activeNoteId, content); }}
                onNoteUpdate={handleSaveNoteGuarded}
                onRename={(title) => { if (activeNoteId) handleRenameNote(activeNoteId, title); }}
                onClose={() => handleTabClose(activeNoteId)}
                onNavigateToNoteLegacy={navigateByTitle}
                onNavigateToNoteById={navigateById}
                viewMode={editorViewMode}
                setViewMode={setEditorViewMode}
                settings={settings}
                tabs={openTabs}
                enteringTabId={enteringTabId}
                enteringFromTabId={enteringFromTabId}
                closingTabIds={Array.from(closingTabIds)}
                onTabChange={handleTabChange}
                onTabClose={handleTabClose}
                onNewTab={handleNewTab}
                onTabEnterComplete={handleTabEnterComplete}
                onTabCloseAnimationComplete={handleTabCloseAnimationComplete}
                onRestoreSnapshot={restoreSnapshotGuarded}
                readOnly={(vaultCacheReadOnly || authoritativeSyncInProgress || hasPendingStructuralOperations) && activeNote?.origin === 'vault'}
                attachmentMutationsDisabled={activeNote?.origin === 'vault'}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-[#2D2D2B]/30 font-redaction select-none">
                <p className="text-sm">No note selected</p>
                <p className="text-xs mt-1">Open a note from the sidebar</p>
              </div>
            )}
          </Suspense>
        </ErrorBoundary>

        {isMobile && isRightPanelOpen && (
          <div
            className="absolute inset-0 bg-black/20 z-30"
            onClick={() => setIsRightPanelOpen(false)}
          />
        )}

        {/* Right Panel — always rendered for slide animation */}
        <div
          className={`flex shrink-0 relative overflow-hidden ${isMobile ? 'absolute inset-y-0 right-0 z-40 shadow-xl' : ''}`}
          style={{
            width: isFocusMode ? '0' : (isMobile ? (isRightPanelOpen ? '80%' : '0') : (isRightPanelOpen ? 'var(--noa-right-panel-width, 310px)' : '0')),
            maxWidth: isMobile ? '320px' : undefined,
            transition: isDraggingRightPanel ? 'none' : 'width 220ms cubic-bezier(0.4, 0, 0.2, 1), border-color 220ms',
            minWidth: 0,
            borderLeftWidth: isFocusMode ? 0 : 1,
            borderLeftStyle: 'solid',
            borderLeftColor: (isRightPanelOpen && !isFocusMode) ? 'var(--panel-divider, #2D2D2B)' : 'transparent',
          }}
        >
          <div
            style={{
              width: isMobile ? '80vw' : 'var(--noa-right-panel-width, 310px)',
              maxWidth: isMobile ? '320px' : undefined,
            }}
            className="flex h-full shrink-0"
          >
            {!isMobile && (
              <div
                className="w-1.5 bg-transparent cursor-col-resize absolute left-0 top-0 bottom-0 z-20"
                onMouseDown={() => setIsDraggingRightPanel(true)}
              />
            )}
            {hasMountedRightPanel && <div className="flex-1 overflow-hidden" data-noa-right-panel-content>
              <ErrorBoundary>
              <Suspense fallback={<div className="h-full flex items-center justify-center text-[#2D2D2B]/60 text-sm">Loading panel…</div>}>
                <RightPanel
                  tasks={globalTasks}
                  onToggleTask={handleToggleTaskGuarded}
                  onNavigateToNoteById={handleRightPanelNavigate}
                  activeNote={activeNote}
                  activeTab={activeRightTab}
                  onTabChange={setActiveRightTab}
                  notes={notes}
                  folders={folders}
                  settings={settings}
                  activeNoteId={activeNote?.id}
                  onUpdateNote={(content) => { if (activeNoteId) handleUpdateNote(activeNoteId, content); }}
                />
              </Suspense>
              </ErrorBoundary>
            </div>}
          </div>
        </div>
      </div>
      {saveError && (
        <div className="fixed bottom-4 right-4 z-50 border border-[#EC9A3C]/40 bg-[#F9F9F7] px-4 py-3 max-w-sm font-redaction rounded-md shadow-[4px_4px_0px_0px_rgba(45,45,43,0.15)]">
          <div className="text-xs font-bold text-[#A26721] uppercase tracking-wider mb-1">Warning · Save</div>
          <div className="text-xs text-[#2D2D2B]/70 leading-relaxed mb-3">{saveError}</div>
          <button
            onClick={clearSaveError}
            className="text-[10px] uppercase tracking-wider font-bold border border-[#2D2D2B]/40 px-2 py-0.5 text-[#2D2D2B] hover:bg-[#EFEAE3] transition-colors active:opacity-70 rounded"
          >
            Dismiss
          </button>
        </div>
      )}
      {externalUpdateNotice && (
        <div className="fixed bottom-4 left-4 z-50 border border-[#CC7D5E]/60 bg-[#F9F9F7] px-4 py-2.5 max-w-sm font-redaction rounded-md shadow-[4px_4px_0px_0px_rgba(45,45,43,0.15)]">
          <div className="text-xs font-bold text-[#CC7D5E] uppercase tracking-wider mb-0.5">Vault Sync</div>
          <div className="text-xs text-[#2D2D2B]/70 leading-relaxed">{externalUpdateNotice}</div>
        </div>
      )}
      {fsSyncError && fsHandle && (
        <div className="fixed bottom-4 left-4 z-50 border border-[#2D2D2B]/40 bg-[#F9F9F7] px-4 py-3 max-w-sm font-redaction rounded-md">
          <div className="text-xs font-bold text-[#2D2D2B] uppercase tracking-wider mb-1">Error · Vault Sync</div>
          <div className="text-xs text-[#2D2D2B]/60 leading-relaxed mb-3">
            {needsReauth
              ? 'Vault access is paused. Reconnect the folder before editing; cached notes are read-only.'
              : autoRetryExhausted
                ? 'Vault sync failed after several attempts. Retry or disconnect before editing; cached notes are read-only.'
                : fsSyncError}
          </div>
          <div className="flex gap-2">
            <button
              disabled={syncStatus === 'syncing'}
              onClick={needsReauth ? reconnect : retry}
              className="text-[10px] uppercase tracking-wider font-bold border border-[#2D2D2B]/40 px-2 py-0.5 text-[#2D2D2B] hover:bg-[#EFEAE3] transition-colors active:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed rounded"
            >
              {needsReauth ? 'Reconnect Folder' : 'Retry Sync'}
            </button>
            {permissionRevoked && (
              <button
                disabled={syncStatus === 'syncing'}
                onClick={() => { void handleDisconnectFolder().catch(() => {}); }}
                className="text-[10px] uppercase tracking-wider font-bold border border-[#2D2D2B]/40 px-2 py-0.5 text-[#2D2D2B] hover:bg-[#EFEAE3] transition-colors active:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed rounded"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}
      {showStorageNotice && (
        <div className="fixed bottom-20 right-4 z-50 border border-[#2D2D2B]/20 bg-[#EFEAE3] px-4 py-3 max-w-xs font-redaction shadow-[4px_4px_0px_0px_rgba(45,45,43,0.25)]">
          <div className="text-xs font-bold text-[#2D2D2B] uppercase tracking-wider mb-1">Local Storage Only</div>
          <div className="text-xs text-[#2D2D2B]/60 leading-relaxed mb-3">
            {LOCAL_DATA_BOUNDARY_COPY}
          </div>
          <button
            onClick={() => {
              setShowStorageNotice(false);
              try { localStorage.setItem(STORAGE_KEYS.STORAGE_NOTICE_SEEN, '1'); } catch { /* quota exceeded */ }
            }}
            className="text-[10px] uppercase tracking-wider font-bold border border-[#2D2D2B]/30 px-2 py-0.5 text-[#2D2D2B]/60 hover:text-[#2D2D2B] hover:border-[#2D2D2B]/60 transition-colors"
          >
            Got it
          </button>
        </div>
      )}
      {loadError && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl bg-[#F9F9F7] border-2 border-[#2D2D2B] shadow-[4px_4px_0px_0px_rgba(45,45,43,0.25)] p-4 font-redaction space-y-3 slide-down">
            <h3 className="text-sm font-bold tracking-wider uppercase">Recovery Needed</h3>
            <p className="text-sm text-[#2D2D2B]/80">{loadError.message}</p>
            <p className="text-xs text-[#2D2D2B]/60">{LOCAL_DATA_BOUNDARY_COPY}</p>
            <p className="text-xs text-[#2D2D2B]/60">Choose an action: retry loading, import a JSON backup, or reset to a new workspace.</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={retryInitialization}
                className="px-3 py-1 text-xs font-bold bg-[#F9F9F7] border-2 border-[#2D2D2B] hover:bg-[#EFEAE3]"
              >
                Retry Read
              </button>
              <button
                onClick={() => recoveryImportInputRef.current?.click()}
                className="px-3 py-1 text-xs font-bold bg-[#CC7D5E] text-white border-2 border-[#2D2D2B] hover:opacity-90"
              >
                Import Backup
              </button>
              <button
                onClick={() => {
                  void resetWorkspaceFromRecovery();
                }}
                className="px-3 py-1 text-xs font-bold bg-[#D45555]/15 text-[#953333] border-2 border-[#D45555]/60 hover:bg-[#D45555]/30"
              >
                New Empty Workspace
              </button>
            </div>
            <input
              ref={recoveryImportInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void importBackupFromRecovery(file);
                }
                e.currentTarget.value = '';
              }}
            />
          </div>
        </div>
      )}
      {commandPalette.isOpen && (
        <div className="fixed inset-0 z-[70] bg-black/30 flex items-start justify-center pt-24 px-4" onClick={commandPalette.close}>
          <div
            className="w-full max-w-xl border-2 border-[#2D2D2B] bg-[#F9F9F7] shadow-[4px_4px_0px_0px_rgba(45,45,43,0.25)] slide-down"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#2D2D2B] p-3 bg-[#EFEAE3]">
              <input
                ref={commandPalette.inputRef}
                type="text"
                value={commandPalette.query}
                onChange={(e) => commandPalette.setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    commandPalette.close();
                    return;
                  }
                  if (e.key === 'Enter' && commandPalette.items[0]) {
                    e.preventDefault();
                    commandPalette.run(commandPalette.items[0].action);
                  }
                }}
                placeholder="Type a command or note title..."
                className="w-full bg-[#F9F9F7] border border-[#2D2D2B] px-3 py-2 text-sm font-redaction outline-none focus:border-[#CC7D5E]"
              />
            </div>
            <div className="max-h-80 overflow-y-auto [scrollbar-gutter:stable] p-2 space-y-1">
              {commandPalette.items.length === 0 ? (
                <div className="px-2 py-3 text-xs text-[#2D2D2B]/60">No matching commands.</div>
              ) : (
                commandPalette.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => commandPalette.run(item.action)}
                    className="w-full text-left px-3 py-2 text-sm border border-transparent hover:border-[#2D2D2B]/30 hover:bg-[#EFEAE3]/50 font-redaction"
                  >
                    {item.label}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            onClose={() => setIsSettingsOpen(false)}
            settings={settings}
            updateSettings={updateSettings}
            editorViewMode={editorViewMode}
            setEditorViewMode={setEditorViewMode}
            notes={notes}
            folders={folders}
            workspaceName={workspaceName}
            onImportData={handleImportData}
            fsHandle={fsHandle}
            onConnectFs={connect}
            onDisconnectFs={handleDisconnectFolder}
            fsLastSyncAt={fsLastSyncAt}
            fsSyncError={fsSyncError}
            syncStatus={syncStatus}
            onRetryFsSync={retry}
            autoBackup={autoBackup}
          />
        </Suspense>
      )}
      {navigationConflict && (
        <div className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center px-4" onClick={() => setNavigationConflict(null)}>
          <div className="w-full max-w-lg border-2 border-[#2D2D2B] bg-[#F9F9F7] shadow-[4px_4px_0px_0px_rgba(45,45,43,0.25)] slide-down" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-[#2D2D2B] px-4 py-3 bg-[#EFEAE3]">
              <div className="text-xs uppercase tracking-wider text-[#2D2D2B]/60 font-bold">Duplicate Title</div>
              <div className="text-sm text-[#2D2D2B] mt-1">
                Multiple notes match "<span className="font-bold">{navigationConflict.title}</span>". Select one:
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto [scrollbar-gutter:stable] p-2 space-y-1">
              {navigationConflict.noteIds.map((id) => {
                const note = notes.find((item) => item.id === id);
                if (!note) return null;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      navigateById(id);
                      setNavigationConflict(null);
                    }}
                    className="w-full text-left border border-[#2D2D2B]/20 hover:border-[#2D2D2B]/50 px-3 py-2 bg-[#F9F9F7] hover:bg-[#EFEAE3]/40"
                  >
                    <div className="text-sm font-bold text-[#2D2D2B] truncate">{note.title}</div>
                    <div className="text-xs text-[#2D2D2B]/60 mt-0.5">
                      {folderNameById.get(note.folder) ?? 'No Folder'} · Created {new Date(note.createdAt).toLocaleString()}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-[#2D2D2B]/20 px-4 py-2 flex justify-end">
              <button
                onClick={() => setNavigationConflict(null)}
                className="text-xs uppercase tracking-wider font-bold border border-[#2D2D2B]/30 px-2 py-1 text-[#2D2D2B]/70 hover:text-[#2D2D2B]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingTemplateNoteId && (() => {
        const userTemplates = settings.templates?.userTemplates ?? [];
        const allTemplates = [...builtinTemplates, ...userTemplates];
        const pendingNote = notes.find(n => n.id === pendingTemplateNoteId);
        const noteTitle = pendingNote?.title ?? 'New Note';
        const dateFormat = settings.dailyNotes.dateFormat;
        return (
          <div className="fixed inset-0 z-[65] bg-black/30 flex items-center justify-center px-4" onClick={() => setPendingTemplateNoteId(null)}>
            <div className="w-full max-w-sm border-2 border-[#2D2D2B] bg-[#F9F9F7] shadow-[4px_4px_0px_0px_rgba(45,45,43,0.25)] slide-down" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-[#2D2D2B] px-4 py-3 bg-[#EFEAE3] flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[#2D2D2B]/60 font-bold">Choose Template</div>
                  <div className="text-sm text-[#2D2D2B] mt-0.5">Pick a template for this note</div>
                </div>
                <button onClick={() => setPendingTemplateNoteId(null)} className="text-[#2D2D2B]/50 hover:text-[#2D2D2B] text-lg leading-none active:opacity-70">×</button>
              </div>
              <div className="p-2 space-y-1 max-h-80 overflow-y-auto [scrollbar-gutter:stable]">
                {allTemplates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (t.id !== 'blank') {
                        handleUpdateNote(pendingTemplateNoteId, applyTemplate(t, noteTitle, dateFormat));
                      }
                      setPendingTemplateNoteId(null);
                    }}
                    className="w-full text-left border border-[#2D2D2B]/20 hover:border-[#2D2D2B]/50 px-3 py-2 bg-[#F9F9F7] hover:bg-[#EFEAE3]/40 active:opacity-70"
                  >
                    <div className="text-sm font-bold text-[#2D2D2B]">{t.name}</div>
                    {t.content && (
                      <div className="text-xs text-[#2D2D2B]/50 mt-0.5 truncate">{t.content.slice(0, 60)}{t.content.length > 60 ? '…' : ''}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
      {isFocusMode && (
        <button
          onClick={exitFocusMode}
          className="fixed top-3 right-4 z-50 text-[#2D2D2B]/40 hover:text-[#2D2D2B] text-xs font-redaction px-2 py-1 border border-[#2D2D2B]/20 hover:border-[#2D2D2B]/50 bg-[#F9F9F7]/80 backdrop-blur-sm active:opacity-70 transition-opacity"
          title="Exit focus mode (Esc)"
        >
          Esc
        </button>
      )}
      {tabLimitWarning && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[#2D2D2B] text-[#F9F9F7] text-xs px-3 py-1.5 font-redaction pointer-events-none">
          A tab was closed to make room (max 20 tabs)
        </div>
      )}
    </div>
  );
}
