/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from './constants/storageKeys';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import { parseTasksFromNotes } from './lib/taskParser';
import { useSettings } from './hooks/useSettings';
import { useNotes } from './hooks/useNotes';
import { useLayout } from './hooks/useLayout';
import { useFileSync } from './hooks/useFileSync';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useAutoBackup } from './hooks/useAutoBackup';
import { useCommandPalette } from './hooks/useCommandPalette';
import ThemeInjector from './components/ThemeInjector';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LOCAL_DATA_BOUNDARY_COPY } from './lib/userFacingCopy';
import { deleteNoteWithLocalFirst } from './lib/deleteFlow';
import { isDescendantPath } from './lib/pathUtils';
import { builtinTemplates, applyTemplate } from './lib/templates';

const Editor = lazy(() => import('./components/Editor'));
const RightPanel = lazy(() => import('./components/RightPanel'));
const SettingsModal = lazy(() => import('./components/settings/SettingsModal'));

const OPEN_TABS_KEY = STORAGE_KEYS.OPEN_TABS;
const MAX_OPEN_TABS = 20;

export default function App() {
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
    isLoaded,
    setWorkspaceName,
  } = useNotes(settings);

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
    connect,
    disconnect,
    retry,
    reconnect,
    syncNoteOnUpdate,
    syncNoteOnMove,
    syncNoteOnRename,
    syncFolderOnRename,
    syncFolderOnCreate,
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
  });

  const blockVaultCacheWrite = useCallback(() => {
    if (!vaultCacheReadOnly) return false;
    setSaveError('Vault is the source of truth. Reconnect or retry sync before making changes.');
    return true;
  }, [setSaveError, vaultCacheReadOnly]);

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
    if (blockVaultCacheWrite()) return;
    _handleUpdateNote(id, content);
    syncNoteOnUpdate(id, content);
  }, [_handleUpdateNote, blockVaultCacheWrite, syncNoteOnUpdate]);

  const handleRenameNote = useCallback((id: string, newTitle: string) => {
    if (blockVaultCacheWrite()) return;
    _handleRenameNote(id, newTitle);
    syncNoteOnRename(id, newTitle);
  }, [_handleRenameNote, blockVaultCacheWrite, syncNoteOnRename]);

  const handleCreateNote = useCallback((folderId: string, initialContent?: string) => {
    if (blockVaultCacheWrite()) return '';
    const createdId = _handleCreateNote(folderId, initialContent);
    // New note will be saved by useNotes via storage.saveNote; FS sync on next update
    const userTemplates = settings.templates?.userTemplates ?? [];
    if (createdId && userTemplates.length > 0 && !initialContent) {
      waitingForTemplateRef.current = true;
    }
    return createdId;
  }, [_handleCreateNote, blockVaultCacheWrite, settings.templates?.userTemplates]);

  const handleSaveNoteGuarded = useCallback((note: Parameters<typeof handleSaveNote>[0]) => {
    if (blockVaultCacheWrite()) return;
    handleSaveNote(note);
  }, [blockVaultCacheWrite, handleSaveNote]);

  const handleImportNoteGuarded = useCallback((...args: Parameters<typeof handleImportNote>) => {
    if (blockVaultCacheWrite()) return;
    handleImportNote(...args);
  }, [blockVaultCacheWrite, handleImportNote]);

  const handleOpenDailyNoteGuarded = useCallback(() => {
    if (blockVaultCacheWrite()) return;
    handleOpenDailyNote();
  }, [blockVaultCacheWrite, handleOpenDailyNote]);

  const handleToggleTaskGuarded = useCallback((task: Parameters<typeof handleToggleTask>[0]) => {
    if (blockVaultCacheWrite()) return;
    const toggled = handleToggleTask(task);
    // Write through to the vault — a storage-only toggle would be reverted by
    // the next disk-authoritative scan.
    if (toggled) syncNoteOnUpdate(toggled.noteId, toggled.content);
  }, [blockVaultCacheWrite, handleToggleTask, syncNoteOnUpdate]);

  const restoreSnapshotGuarded = useCallback(async (snapshot: Parameters<typeof restoreSnapshot>[0]) => {
    if (blockVaultCacheWrite()) return;
    await restoreSnapshot(snapshot);
    // Write through to the vault — a storage-only restore would be reverted by
    // the next disk-authoritative scan.
    syncNoteOnUpdate(snapshot.noteId, snapshot.content);
  }, [blockVaultCacheWrite, restoreSnapshot, syncNoteOnUpdate]);

  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { activeNoteIdRef.current = activeNoteId; }, [activeNoteId]);

  const handleMoveNote = useCallback((id: string, folderId: string) => {
    if (blockVaultCacheWrite()) return;
    const note = notesRef.current.find((item) => item.id === id);
    if (!note || note.folder === folderId) return;
    _handleMoveNote(id, folderId);
    syncNoteOnMove(id, note.folder, folderId);
  }, [_handleMoveNote, blockVaultCacheWrite, syncNoteOnMove]);

  const handleCreateFolder = useCallback((parentFolderId?: string) => {
    if (blockVaultCacheWrite()) return;
    const createdName = _handleCreateFolder(parentFolderId);
    // Materialise the directory on disk immediately (Obsidian-style): an
    // empty folder that only lives in IndexedDB would be dropped by the next
    // disk-authoritative scan.
    if (createdName) syncFolderOnCreate(createdName);
  }, [_handleCreateFolder, blockVaultCacheWrite, syncFolderOnCreate]);

  const handleRenameFolder = useCallback((id: string, newName: string) => {
    if (blockVaultCacheWrite()) return;
    const oldFolder = folders.find((folder) => folder.id === id);
    if (!oldFolder) return;
    _handleRenameFolder(id, newName);

    const previousName = oldFolder.name;
    const nextName = newName.trim() || 'Untitled Folder';
    const nextFolders = folders.map((folder) => {
      if (folder.id === id) return { ...folder, name: nextName };
      if (isDescendantPath(folder.name, previousName)) {
        return { ...folder, name: nextName + folder.name.slice(previousName.length) };
      }
      return folder;
    });

    syncFolderOnRename(id, previousName, nextFolders);
  }, [_handleRenameFolder, blockVaultCacheWrite, folders, syncFolderOnRename]);

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
    if (blockVaultCacheWrite()) return;
    void deleteNoteWithLocalFirst({
      id,
      deleteLocal: _handleDeleteNote,
      closeTab: closeTabById,
      syncDelete: syncNoteOnDelete,
    });
  }, [_handleDeleteNote, blockVaultCacheWrite, closeTabById, syncNoteOnDelete]);

  const handleDeleteFolder = useCallback((id: string) => {
    if (blockVaultCacheWrite()) return;
    const folderName = folders.find((folder) => folder.id === id)?.name;
    void (async () => {
      try {
        const deletedNoteIds = await _handleDeleteFolder(id);
        deletedNoteIds.forEach((noteId) => closeTabById(noteId));
        deletedNoteIds.forEach((noteId) => syncNoteOnDelete(noteId));
        // Remove the (now empty) directory tree so the next disk-authoritative
        // scan does not resurrect the deleted folder. Untracked files survive.
        if (folderName) syncFolderOnDelete(folderName);
      } catch (err) {
        console.error('[App] handleDeleteFolder failed:', err);
      }
    })();
  }, [_handleDeleteFolder, blockVaultCacheWrite, closeTabById, folders, syncFolderOnDelete, syncNoteOnDelete]);

  const handleDisconnectFolder = useCallback(async () => {
    try {
      await disconnect();
      const deletedNoteIds = await clearWorkspaceAfterDisconnect();
      deletedNoteIds.forEach((id) => closeTabById(id));
    } catch (err) {
      // Surface instead of swallowing — disconnect failures leave the workspace
      // in a half-torn-down state and the user needs to know.
      console.error('[App] handleDisconnectFolder failed:', err);
      setSaveError('Failed to disconnect vault. Check folder permissions and retry.');
    }
  }, [disconnect, clearWorkspaceAfterDisconnect, closeTabById, setSaveError]);

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
    () => folders.find((f) => (f.source ?? 'noa') === 'noa')?.id ?? 'diary',
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

  const globalTasks = useMemo(() => parseTasksFromNotes(notes), [notes]);
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

  const navigateById = useCallback((id: string) => {
    if (!notes.some((note) => note.id === id)) return;
    handleNavigateToNoteById(id);
  }, [handleNavigateToNoteById, notes]);

  const navigateByTitle = useCallback((title: string) => {
    const matched = notes.filter((note) => note.title === title);
    if (matched.length === 1) {
      navigateById(matched[0].id);
      return;
    }
    if (matched.length === 0) {
      handleNavigateToNote(title);
      return;
    }
    setNavigationConflict({ title, noteIds: matched.map((note) => note.id) });
  }, [handleNavigateToNote, navigateById, notes]);

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
      <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-primary, #EAE8E0)' }}>
        <div className="h-12 border-b shrink-0 px-3 flex items-center" style={{ backgroundColor: 'var(--bg-secondary, #DCD9CE)', borderBottomColor: 'var(--panel-divider, #2D2D2D)' }}>
          <div className="h-3 w-44 bg-[#2D2D2D]/10 animate-pulse" />
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-[280px] border-r border-[#2D2D2D]/20 shrink-0 px-3 py-3 space-y-2">
            <div className="h-4 w-28 bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-7 w-full bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-7 w-[90%] bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-7 w-[82%] bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-7 w-[88%] bg-[#2D2D2D]/10 animate-pulse" />
          </div>
          <div className="flex-1 px-6 py-5 space-y-3">
            <div className="h-7 w-48 bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-4 w-full bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-4 w-[97%] bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-4 w-[92%] bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-4 w-[95%] bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-4 w-[85%] bg-[#2D2D2D]/10 animate-pulse" />
          </div>
          <div className="w-[320px] border-l border-[#2D2D2D]/20 shrink-0 px-3 py-3 space-y-2">
            <div className="h-6 w-full bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-10 w-full bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-10 w-full bg-[#2D2D2D]/10 animate-pulse" />
            <div className="h-10 w-full bg-[#2D2D2D]/10 animate-pulse" />
          </div>
        </div>
      </div>
      </>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#EAE8E0] text-[#2D2D2D] font-redaction overflow-hidden selection:bg-[#CC7D5E] selection:text-white">
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
          className={`flex shrink-0 relative overflow-hidden ${isMobile ? 'absolute inset-y-0 left-0 z-40 bg-[#EAE8E0] shadow-xl' : ''}`}
          style={{
            width: isFocusMode ? '0' : (isMobile ? (isSidebarOpen ? '80%' : '0') : (isSidebarOpen ? 'var(--noa-sidebar-width, 280px)' : '0')),
            maxWidth: isMobile ? '320px' : undefined,
            transition: isDraggingSidebar ? 'none' : 'width 220ms cubic-bezier(0.4, 0, 0.2, 1), border-color 220ms',
            minWidth: 0,
            borderRightWidth: isFocusMode ? 0 : 1,
            borderRightStyle: 'solid',
            borderRightColor: (isSidebarOpen && !isFocusMode) ? 'var(--panel-divider, #2D2D2D)' : 'transparent',
          }}
        >
          <div
            style={{
              width: isMobile ? '80vw' : 'var(--noa-sidebar-width, 280px)',
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
                onSelectNote={(id) => {
                  // Switch + arm the entrance synchronously so the editor build
                  // and tab animation aren't gated on an IndexedDB write; flush
                  // the outgoing note's pending saves in the background (timers
                  // are independent of unmount, so nothing is lost).
                  openTabForNote(id, true);
                  setActiveNoteId(id);
                  if (isMobile) setIsSidebarOpen(false);
                  void flushAllPendingSaves().catch(err => {
                    console.error('[Noa] Failed to flush saves on note select:', err);
                  });
                }}
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
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-[#2D2D2D]/60 text-sm">Loading editor…</div>}>
            {activeNoteId ? (
              <Editor
                note={activeNote}
                allNotes={notes}
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
                readOnly={vaultCacheReadOnly}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-[#2D2D2D]/30 font-redaction select-none">
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
            width: isFocusMode ? '0' : (isMobile ? (isRightPanelOpen ? '80%' : '0') : (isRightPanelOpen ? 'var(--noa-right-panel-width, 320px)' : '0')),
            maxWidth: isMobile ? '320px' : undefined,
            transition: isDraggingRightPanel ? 'none' : 'width 220ms cubic-bezier(0.4, 0, 0.2, 1), border-color 220ms',
            minWidth: 0,
            borderLeftWidth: isFocusMode ? 0 : 1,
            borderLeftStyle: 'solid',
            borderLeftColor: (isRightPanelOpen && !isFocusMode) ? 'var(--panel-divider, #2D2D2D)' : 'transparent',
          }}
        >
          <div
            style={{
              width: isMobile ? '80vw' : 'var(--noa-right-panel-width, 320px)',
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
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary>
              <Suspense fallback={<div className="h-full flex items-center justify-center text-[#2D2D2D]/60 text-sm">Loading panel…</div>}>
                <RightPanel
                  tasks={globalTasks}
                  onToggleTask={handleToggleTaskGuarded}
                  onNavigateToNoteById={(id) => {
                    navigateById(id);
                    if (isMobile) setIsRightPanelOpen(false);
                  }}
                  activeNote={activeNote}
                  activeTab={activeRightTab}
                  onTabChange={setActiveRightTab}
                  notes={notes}
                  settings={settings}
                  activeNoteId={activeNote?.id}
                  onUpdateNote={(content) => { if (activeNoteId) handleUpdateNote(activeNoteId, content); }}
                />
              </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </div>
      {saveError && (
        <div className="fixed bottom-4 right-4 z-50 border border-[#EC9A3C] bg-[#EC9A3C]/10 px-4 py-3 max-w-sm shadow-[4px_4px_0px_0px_rgba(45,45,45,0.25)]">
          <div className="text-xs font-bold text-[#8A571C] uppercase tracking-wider mb-1">Warning · Save</div>
          <div className="text-xs text-[#A26721] leading-relaxed mb-3">{saveError}</div>
          <button
            onClick={clearSaveError}
            className="text-[10px] uppercase tracking-wider font-bold border border-[#EC9A3C] px-2 py-0.5 text-[#A26721] hover:bg-[#EC9A3C]/20 transition-colors active:opacity-70"
          >
            Dismiss
          </button>
        </div>
      )}
      {externalUpdateNotice && (
        <div className="fixed bottom-4 left-4 z-50 border border-[#CC7D5E]/60 bg-[#EAE8E0] px-4 py-2.5 max-w-sm font-redaction rounded-md shadow-[4px_4px_0px_0px_rgba(45,45,45,0.15)]">
          <div className="text-xs font-bold text-[#CC7D5E] uppercase tracking-wider mb-0.5">Vault Sync</div>
          <div className="text-xs text-[#2D2D2D]/70 leading-relaxed">{externalUpdateNotice}</div>
        </div>
      )}
      {fsSyncError && fsHandle && (
        <div className="fixed bottom-4 left-4 z-50 border border-[#2D2D2D]/40 bg-[#EAE8E0] px-4 py-3 max-w-sm font-redaction rounded-md">
          <div className="text-xs font-bold text-[#2D2D2D] uppercase tracking-wider mb-1">Error · Vault Sync</div>
          <div className="text-xs text-[#2D2D2D]/60 leading-relaxed mb-3">
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
              className="text-[10px] uppercase tracking-wider font-bold border border-[#2D2D2D]/40 px-2 py-0.5 text-[#2D2D2D] hover:bg-[#DCD9CE] transition-colors active:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed rounded"
            >
              {needsReauth ? 'Reconnect Folder' : 'Retry Sync'}
            </button>
            {permissionRevoked && (
              <button
                disabled={syncStatus === 'syncing'}
                onClick={handleDisconnectFolder}
                className="text-[10px] uppercase tracking-wider font-bold border border-[#2D2D2D]/40 px-2 py-0.5 text-[#2D2D2D] hover:bg-[#DCD9CE] transition-colors active:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed rounded"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}
      {showStorageNotice && (
        <div className="fixed bottom-20 right-4 z-50 border border-[#2D2D2D]/20 bg-[#DCD9CE] px-4 py-3 max-w-xs font-redaction shadow-[4px_4px_0px_0px_rgba(45,45,45,0.25)]">
          <div className="text-xs font-bold text-[#2D2D2D] uppercase tracking-wider mb-1">Local Storage Only</div>
          <div className="text-xs text-[#2D2D2D]/60 leading-relaxed mb-3">
            {LOCAL_DATA_BOUNDARY_COPY}
          </div>
          <button
            onClick={() => {
              setShowStorageNotice(false);
              try { localStorage.setItem(STORAGE_KEYS.STORAGE_NOTICE_SEEN, '1'); } catch { /* quota exceeded */ }
            }}
            className="text-[10px] uppercase tracking-wider font-bold border border-[#2D2D2D]/30 px-2 py-0.5 text-[#2D2D2D]/60 hover:text-[#2D2D2D] hover:border-[#2D2D2D]/60 transition-colors"
          >
            Got it
          </button>
        </div>
      )}
      {loadError && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl bg-[#EAE8E0] border-2 border-[#2D2D2D] shadow-[4px_4px_0px_0px_rgba(45,45,45,0.25)] p-4 font-redaction space-y-3 slide-down">
            <h3 className="text-sm font-bold tracking-wider uppercase">Recovery Needed</h3>
            <p className="text-sm text-[#2D2D2D]/80">{loadError.message}</p>
            <p className="text-xs text-[#2D2D2D]/60">{LOCAL_DATA_BOUNDARY_COPY}</p>
            <p className="text-xs text-[#2D2D2D]/60">Choose an action: retry loading, import a JSON backup, or reset to a new workspace.</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={retryInitialization}
                className="px-3 py-1 text-xs font-bold bg-[#EAE8E0] border-2 border-[#2D2D2D] hover:bg-[#DCD9CE]"
              >
                Retry Read
              </button>
              <button
                onClick={() => recoveryImportInputRef.current?.click()}
                className="px-3 py-1 text-xs font-bold bg-[#CC7D5E] text-white border-2 border-[#2D2D2D] hover:opacity-90"
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
            className="w-full max-w-xl border-2 border-[#2D2D2D] bg-[#EAE8E0] shadow-[4px_4px_0px_0px_rgba(45,45,45,0.25)] slide-down"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#2D2D2D] p-3 bg-[#DCD9CE]">
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
                className="w-full bg-[#EAE8E0] border border-[#2D2D2D] px-3 py-2 text-sm font-redaction outline-none focus:border-[#CC7D5E]"
              />
            </div>
            <div className="max-h-80 overflow-y-auto p-2 space-y-1">
              {commandPalette.items.length === 0 ? (
                <div className="px-2 py-3 text-xs text-[#2D2D2D]/60">No matching commands.</div>
              ) : (
                commandPalette.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => commandPalette.run(item.action)}
                    className="w-full text-left px-3 py-2 text-sm border border-transparent hover:border-[#2D2D2D]/30 hover:bg-[#DCD9CE]/50 font-redaction"
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
          <div className="w-full max-w-lg border-2 border-[#2D2D2D] bg-[#EAE8E0] shadow-[4px_4px_0px_0px_rgba(45,45,45,0.25)] slide-down" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-[#2D2D2D] px-4 py-3 bg-[#DCD9CE]">
              <div className="text-xs uppercase tracking-wider text-[#2D2D2D]/60 font-bold">Duplicate Title</div>
              <div className="text-sm text-[#2D2D2D] mt-1">
                Multiple notes match "<span className="font-bold">{navigationConflict.title}</span>". Select one:
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto p-2 space-y-1">
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
                    className="w-full text-left border border-[#2D2D2D]/20 hover:border-[#2D2D2D]/50 px-3 py-2 bg-[#EAE8E0] hover:bg-[#DCD9CE]/40"
                  >
                    <div className="text-sm font-bold text-[#2D2D2D] truncate">{note.title}</div>
                    <div className="text-xs text-[#2D2D2D]/60 mt-0.5">
                      {folderNameById.get(note.folder) ?? 'No Folder'} · Created {new Date(note.createdAt).toLocaleString()}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-[#2D2D2D]/20 px-4 py-2 flex justify-end">
              <button
                onClick={() => setNavigationConflict(null)}
                className="text-xs uppercase tracking-wider font-bold border border-[#2D2D2D]/30 px-2 py-1 text-[#2D2D2D]/70 hover:text-[#2D2D2D]"
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
            <div className="w-full max-w-sm border-2 border-[#2D2D2D] bg-[#EAE8E0] shadow-[4px_4px_0px_0px_rgba(45,45,45,0.25)] slide-down" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-[#2D2D2D] px-4 py-3 bg-[#DCD9CE] flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[#2D2D2D]/60 font-bold">Choose Template</div>
                  <div className="text-sm text-[#2D2D2D] mt-0.5">Pick a template for this note</div>
                </div>
                <button onClick={() => setPendingTemplateNoteId(null)} className="text-[#2D2D2D]/50 hover:text-[#2D2D2D] text-lg leading-none active:opacity-70">×</button>
              </div>
              <div className="p-2 space-y-1 max-h-80 overflow-y-auto">
                {allTemplates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (t.id !== 'blank') {
                        handleUpdateNote(pendingTemplateNoteId, applyTemplate(t, noteTitle, dateFormat));
                      }
                      setPendingTemplateNoteId(null);
                    }}
                    className="w-full text-left border border-[#2D2D2D]/20 hover:border-[#2D2D2D]/50 px-3 py-2 bg-[#EAE8E0] hover:bg-[#DCD9CE]/40 active:opacity-70"
                  >
                    <div className="text-sm font-bold text-[#2D2D2D]">{t.name}</div>
                    {t.content && (
                      <div className="text-xs text-[#2D2D2D]/50 mt-0.5 truncate">{t.content.slice(0, 60)}{t.content.length > 60 ? '…' : ''}</div>
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
          className="fixed top-3 right-4 z-50 text-[#2D2D2D]/40 hover:text-[#2D2D2D] text-xs font-redaction px-2 py-1 border border-[#2D2D2D]/20 hover:border-[#2D2D2D]/50 bg-[#EAE8E0]/80 backdrop-blur-sm active:opacity-70 transition-opacity"
          title="Exit focus mode (Esc)"
        >
          Esc
        </button>
      )}
      {tabLimitWarning && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[#2D2D2D] text-[#EAE8E0] text-xs px-3 py-1.5 font-redaction pointer-events-none">
          A tab was closed to make room (max 20 tabs)
        </div>
      )}
    </div>
  );
}
