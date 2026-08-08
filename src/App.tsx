/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CommandPaletteDialog from './components/CommandPaletteDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { EmptyStatePrompt } from './components/icons/EmptyStatePrompt';
import { NoaWordmark } from './components/icons/NoaWordmark';
import NavigationConflictDialog from './components/NavigationConflictDialog';
import RecoveryDialog from './components/RecoveryDialog';
import Sidebar from './components/Sidebar';
import TemplatePickerDialog from './components/TemplatePickerDialog';
import ThemeInjector from './components/ThemeInjector';
import TopBar from './components/TopBar';
import { STORAGE_KEYS } from './constants/storageKeys';
import { useAutoBackup } from './hooks/useAutoBackup';
import { useCommandPalette } from './hooks/useCommandPalette';
import { useFileSync } from './hooks/useFileSync';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useGlobalTasks } from './hooks/useGlobalTasks';
import { useLayout } from './hooks/useLayout';
import { useNotes } from './hooks/useNotes';
import { useGlobalScrollingClass } from './hooks/useScrollingClass';
import { useSettings } from './hooks/useSettings';
import { useSidebarPreview } from './hooks/useSidebarPreview';
import { useTabs } from './hooks/useTabs';
import { useVaultOperations } from './hooks/useVaultOperations';
import { LOCAL_DATA_BOUNDARY_COPY } from './lib/userFacingCopy';

const Editor = lazy(() => import('./components/Editor'));
const RightPanel = lazy(() => import('./components/RightPanel'));
const SettingsModal = lazy(() => import('./components/settings/SettingsModal'));

export default function App() {
  useGlobalScrollingClass();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);
  const toggleSearch = useCallback(() => {
    if (isSearchOpen) {
      setSearchQuery('');
      setIsSearchOpen(false);
      return;
    }
    openSearch();
  }, [isSearchOpen, openSearch]);
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
    advanceVaultNoteBaseline,
    isLoaded,
    isDataReady,
    setWorkspaceName,
  } = useNotes(settings);

  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  const {
    openTabs,
    enteringTabId,
    enteringFromTabId,
    closingTabIds,
    tabLimitWarning,
    openTabForNote,
    closeTabById,
    handleTabClose,
    handleTabEnterComplete,
    handleTabCloseAnimationComplete,
  } = useTabs({ notes, isLoaded: isDataReady, activeNoteId, setActiveNoteId });

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
    isLoaded: isDataReady,
    notes,
    folders,
    workspaceName,
    activeNoteId,
    ensureInitialNote,
    onImportData: handleImportData,
    onVaultNotesSynced: markVaultNotesSynced,
    onVaultNoteBaselineAdvanced: advanceVaultNoteBaseline,
  });

  const blockVaultCacheWrite = useCallback((isVaultOwned: boolean) => {
    if (!isDataReady) return true;
    const authoritativeSyncActive = isAuthoritativeSyncActive();
    const structuralOperationPending = isAnyVaultStructuralOperationPending();
    if (!isVaultOwned || (!vaultCacheReadOnly && !authoritativeSyncActive && !structuralOperationPending)) return false;
    setSaveError(structuralOperationPending
      ? 'A vault file operation is still pending. Retry sync before making more changes.'
      : authoritativeSyncActive
        ? 'Vault changes are being applied from disk. Wait for sync to finish before editing.'
        : 'Vault is the source of truth. Reconnect or retry sync before making changes.');
    return true;
  }, [isAnyVaultStructuralOperationPending, isAuthoritativeSyncActive, isDataReady, setSaveError, vaultCacheReadOnly]);

  const autoBackup = useAutoBackup({
    notes,
    folders,
    workspaceName,
    isLoaded: isDataReady,
    autoBackupEnabled: settings.backup?.autoBackupEnabled ?? false,
    onSettingsUpdate: useCallback((patch: { autoBackupEnabled: boolean }) => {
      updateSettings((prev) => ({
        ...prev,
        backup: { ...prev.backup, autoBackupEnabled: patch.autoBackupEnabled },
      }));
    }, [updateSettings]),
    getIsImporting,
  });

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
    if (!isDataReady) return;
    handleOpenDailyNote();
  }, [handleOpenDailyNote, isDataReady]);

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

  const {
    handleDeleteNote,
    handleRenameFolder,
    handleDeleteFolder,
    handleDisconnectFolder,
  } = useVaultOperations({
    isDataReady,
    notes,
    folders,
    setSaveError,
    closeTabById,
    blockVaultCacheWrite,
    handleDeleteNote: _handleDeleteNote,
    handleRenameFolder: _handleRenameFolder,
    handleDeleteFolder: _handleDeleteFolder,
    clearWorkspaceAfterDisconnect,
    isVaultEntityOperationPending,
    reserveVaultStructuralOperation,
    releaseVaultStructuralOperation,
    prepareVaultStructuralOperations,
    cancelVaultStructuralOperations,
    hasPendingStructuralOperations,
    beginDisconnect,
    cancelDisconnect,
    disconnect,
    syncNoteOnDelete,
    syncFolderOnRename,
    syncFolderOnDelete,
  });

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
    sidebarWidth,
    rightPanelWidth,
    nudgeSidebarWidth,
    nudgeRightPanelWidth,
    editorViewMode,
    setEditorViewMode,
    isFocusMode,
    toggleFocusMode,
    exitFocusMode,
  } = useLayout();

  const {
    isSidebarPreviewOpen,
    isSidebarPreviewClosing,
    isPromotingSidebarPreview,
    isReversingSidebarPromotion,
    isSettlingSidebarPromotionClose,
    isSidebarMaterialActive,
    sidebarToggleRef,
    cancelSidebarPreviewClose,
    openSidebarPreview,
    scheduleSidebarPreviewClose,
    toggleSidebar,
    finishSidebarPreviewExit,
    finishSidebarDockMotion,
    finishSidebarPromotion,
    handleSidebarResizeStart,
  } = useSidebarPreview({
    isMobile,
    isFocusMode,
    isSidebarOpen,
    setIsSidebarOpen,
    isDraggingSidebar,
    setIsDraggingSidebar,
  });

  const pendingSearchFocusRef = useRef(false);
  const focusSearch = useCallback(() => {
    if (isFocusMode) {
      pendingSearchFocusRef.current = true;
      exitFocusMode();
      return;
    }
    openSearch();
  }, [isFocusMode, exitFocusMode, openSearch]);
  useEffect(() => {
    if (isFocusMode || !pendingSearchFocusRef.current) return;
    pendingSearchFocusRef.current = false;
    openSearch();
  }, [isFocusMode, openSearch]);
  useEffect(() => {
    if (!isSearchOpen || isFocusMode) return;
    const frameId = window.requestAnimationFrame(() => {
      // preventScroll: the field is still mid-expand and sits outside its
      // clipped shell, so a scrolling focus would drag the search icon
      // sideways for a frame.
      searchInputRef.current?.focus({ preventScroll: true });
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isFocusMode, isSearchOpen]);

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

  const handleNewTab = useCallback(() => {
    const createdId = handleCreateNote(primaryNoaFolderId);
    if (createdId) openTabForNote(createdId, true);
  }, [primaryNoaFolderId, handleCreateNote, openTabForNote]);

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
    onFocusSearch: focusSearch,
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
    enabled: isDataReady,
    searchQuery,
    searchInputRef,
    onCreateNote: () => handleCreateNote(primaryNoaFolderId),
    onOpenDailyNote: handleOpenDailyNoteGuarded,
    onOpenCommandPalette: () => commandPalette.setIsOpen(true),
    onFocusSearch: focusSearch,
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
    <>
    <div
      inert={loadError ? true : undefined}
      aria-hidden={loadError ? true : undefined}
      className="noa-app-shell h-screen w-screen flex flex-col bg-[#F9F9F7] text-[#2D2D2B] font-redaction overflow-hidden relative selection:bg-[#CC7D5E] selection:text-white"
      style={{
        '--noa-titlebar-search-extra': isSearchOpen ? '9rem' : '0px',
        '--noa-sidebar-material-width': isSidebarOpen && !isMobile && !isFocusMode
          ? 'var(--noa-sidebar-width, 325px)'
          : '0px',
        transition: isDraggingSidebar
          ? 'none'
          : '--noa-sidebar-material-width 220ms cubic-bezier(0.4, 0, 0.2, 1)',
      } as React.CSSProperties}
    >
      <ThemeInjector settings={settings} />
      {!isMobile && !isFocusMode && (
        <div
          aria-hidden="true"
          data-sidebar-separator="true"
          className={`pointer-events-none absolute top-0 bottom-0 z-30 ${isPromotingSidebarPreview ? 'noa-sidebar-promotion-divider' : ''}`}
          style={{
            // Keep the separator in the same animated track as the sidebar,
            // then finish one pixel outside the viewport instead of leaving a
            // dark endpoint at the app's left edge.
            left: isPromotingSidebarPreview
              ? undefined
              : isSidebarOpen ? 'var(--noa-sidebar-width, 325px)' : '-1px',
            width: '1px',
            backgroundColor: 'var(--panel-divider, #2D2D2B)',
            opacity: isSidebarOpen ? 1 : 0,
            // A direct toggle follows the sliding sidebar edge. During preview
            // promotion the divider is already at its final edge and remains
            // fixed while the editor layout catches up.
            transition: isPromotingSidebarPreview || isDraggingSidebar
              ? 'none'
              : `left 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 0ms linear ${isSidebarOpen ? '0ms' : '220ms'}`,
          }}
        />
      )}
      {!isMobile && !isFocusMode && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 z-20"
          style={{
            right: isRightPanelOpen ? 'var(--noa-right-panel-width, 310px)' : '-1px',
            width: '1px',
            backgroundColor: 'var(--panel-divider, #2D2D2B)',
            transition: isDraggingRightPanel ? 'none' : 'right 220ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      )}
      {!isMobile && !isFocusMode && (
        <div
          aria-hidden="true"
          data-sidebar-column-surface="true"
          data-sidebar-expanded={isSidebarMaterialActive ? 'true' : undefined}
          data-sidebar-preview-shell={isSidebarPreviewOpen ? 'true' : undefined}
          data-sidebar-preview-closing={isSidebarPreviewClosing ? 'true' : undefined}
          onMouseEnter={isSidebarPreviewOpen ? cancelSidebarPreviewClose : undefined}
          onMouseLeave={isSidebarPreviewOpen ? scheduleSidebarPreviewClose : undefined}
          onTransitionEnd={finishSidebarPreviewExit}
          className={`absolute inset-y-0 left-0 overflow-hidden ${isSidebarPreviewOpen ? 'noa-sidebar-preview-shell noa-sidebar-preview-motion z-40 rounded-r-[14px]' : 'pointer-events-none z-10'}`}
          style={{
            width: isSidebarOpen || isSidebarPreviewOpen || isPromotingSidebarPreview
              ? 'var(--noa-sidebar-width, 325px)'
              : '0px',
            backgroundColor: isSidebarPreviewOpen
              ? 'var(--bg-primary, #F9F9F7)'
              : 'var(--bg-sidebar, #F4F4F2)',
            opacity: isSidebarPreviewOpen ? undefined : isSidebarOpen || isPromotingSidebarPreview ? 1 : 0,
            transition: isSidebarPreviewOpen
              ? undefined
              : isPromotingSidebarPreview || isSettlingSidebarPromotionClose || isDraggingSidebar
                ? 'none'
                : `width 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 0ms linear ${isSidebarOpen ? '0ms' : '220ms'}`,
          }}
        />
      )}
      {!isFocusMode && <TopBar
        settings={settings}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleSidebar={toggleSidebar}
        sidebarToggleRef={sidebarToggleRef}
        onSidebarPreviewEnter={openSidebarPreview}
        onSidebarPreviewLeave={scheduleSidebarPreviewClose}
        onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
        isSidebarOpen={isSidebarOpen}
        isSidebarMaterialActive={isSidebarMaterialActive}
        isSidebarPreviewOpen={isSidebarPreviewOpen}
        isRightPanelOpen={isRightPanelOpen}
        isMobile={isMobile}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isSearchOpen={isSearchOpen}
        onToggleSearch={toggleSearch}
        onCloseSearch={() => {
          setSearchQuery('');
          setIsSearchOpen(false);
        }}
        // Losing focus must not destroy the search. Blur fires on mousedown,
        // before click — tearing the results down there would unmount the row
        // the user is clicking and swallow the click. An active query keeps the
        // field open; clearing stays with the explicit exits (Escape, the clear
        // button, the search icon, the sidebar's close button).
        onSearchBlur={() => {
          if (searchQuery) return;
          setIsSearchOpen(false);
        }}
        searchInputRef={searchInputRef}
      />}
      <div className="flex-1 flex min-h-0 overflow-visible relative">
        {isMobile && isSidebarOpen && (
          <div
            className="absolute inset-0 bg-black/20 z-30"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {!isMobile && isPromotingSidebarPreview && (
          <div
            aria-hidden="true"
            data-sidebar-promotion-spacer="true"
            data-sidebar-promotion-closing={isReversingSidebarPromotion ? 'true' : undefined}
            className="noa-sidebar-promotion-spacer h-full shrink-0"
            onTransitionEnd={finishSidebarPromotion}
          />
        )}

        {/* Sidebar — always rendered for slide animation */}
        <div
          data-sidebar-container
          data-sidebar-expanded={isSidebarMaterialActive ? 'true' : undefined}
          inert={isFocusMode || (!isSidebarOpen && !isSidebarPreviewOpen) ? true : undefined}
          data-sidebar-preview={isSidebarPreviewOpen ? 'true' : undefined}
          data-sidebar-preview-closing={isSidebarPreviewClosing ? 'true' : undefined}
          onMouseEnter={isSidebarPreviewOpen ? cancelSidebarPreviewClose : undefined}
          onMouseLeave={isSidebarPreviewOpen ? scheduleSidebarPreviewClose : undefined}
          onTransitionEnd={finishSidebarDockMotion}
          onTransitionCancel={finishSidebarDockMotion}
          className={`flex shrink-0 overflow-hidden ${isMobile ? 'noa-sidebar-surface absolute inset-y-0 left-0 z-40 shadow-xl' : isSidebarPreviewOpen ? 'noa-sidebar-preview-motion absolute inset-y-0 z-50 rounded-br-[14px]' : isPromotingSidebarPreview ? 'absolute inset-y-0 left-0 z-50' : 'relative z-20'}`}
          style={{
            width: isMobile ? '80%' : 'var(--noa-sidebar-width, 325px)',
            maxWidth: isMobile ? '320px' : undefined,
            marginLeft: !isMobile && !isPromotingSidebarPreview && (isFocusMode || !isSidebarOpen)
              ? 'calc(-1 * var(--noa-sidebar-width, 325px))'
              : '0px',
            left: !isMobile
              ? (isSidebarPreviewOpen ? 'var(--noa-sidebar-width, 325px)' : isPromotingSidebarPreview ? '0px' : undefined)
              : undefined,
            transform: isMobile
              ? (isFocusMode || !isSidebarOpen ? 'translateX(-100%)' : 'translateX(0)')
              : undefined,
            transition: isSidebarPreviewOpen
              ? undefined
              : isDraggingSidebar || isPromotingSidebarPreview || isSettlingSidebarPromotionClose
                ? 'none'
                : (isMobile ? 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)' : 'margin-left 220ms cubic-bezier(0.4, 0, 0.2, 1)'),
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: isMobile ? '80vw' : 'var(--noa-sidebar-width, 325px)',
              maxWidth: isMobile ? '320px' : undefined,
            }}
            className="flex h-full shrink-0"
          >
            <div className="flex-1 min-h-0 overflow-hidden">
              <Sidebar
                notes={notes}
                folders={folders}
                searchQuery={searchQuery}
                activeNoteId={activeNoteId}
                onSelectNote={handleSidebarSelectNote}
                onCreateNote={handleCreateNote}
                onDeleteNote={handleDeleteNote}
                onRenameNote={handleRenameNote}
                onMoveNote={handleMoveNote}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
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
                onMouseDown={handleSidebarResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar"
                aria-valuenow={Math.round(sidebarWidth)}
                aria-valuemin={310}
                aria-valuemax={480}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeSidebarWidth(-16); }
                  if (e.key === 'ArrowRight') { e.preventDefault(); nudgeSidebarWidth(16); }
                }}
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
                closingTabIds={closingTabIds}
                onTabChange={handleTabChange}
                onTabClose={handleTabClose}
                onNewTab={handleNewTab}
                onTabEnterComplete={handleTabEnterComplete}
                onTabCloseAnimationComplete={handleTabCloseAnimationComplete}
                liftTabStrip={!isMobile && !isFocusMode}
                reserveTitlebarTraffic={!isMobile && !isFocusMode && !isSidebarOpen}
                reserveTitlebarActions={!isMobile && !isFocusMode && !isRightPanelOpen}
                onRestoreSnapshot={restoreSnapshotGuarded}
                readOnly={(vaultCacheReadOnly || authoritativeSyncInProgress || hasPendingStructuralOperations) && activeNote?.origin === 'vault'}
                attachmentMutationsDisabled={!isDataReady || activeNote?.origin === 'vault'}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-7 select-none">
                <NoaWordmark className="w-20 sm:w-24 h-auto noa-empty-state-mark" />
                <EmptyStatePrompt className="w-44 sm:w-48 h-auto noa-empty-state-caption" />
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
          className={`flex shrink-0 min-h-0 relative overflow-hidden ${isMobile ? 'absolute inset-y-0 right-0 z-40 shadow-xl' : ''}`}
          style={{
            width: isMobile ? '80%' : 'var(--noa-right-panel-width, 310px)',
            maxWidth: isMobile ? '320px' : undefined,
            marginRight: !isMobile && (isFocusMode || !isRightPanelOpen) ? 'calc(-1 * var(--noa-right-panel-width, 310px))' : '0px',
            transform: isMobile
              ? (isFocusMode || !isRightPanelOpen ? 'translateX(100%)' : 'translateX(0)')
              : undefined,
            transition: isDraggingRightPanel ? 'none' : (isMobile ? 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)' : 'margin-right 220ms cubic-bezier(0.4, 0, 0.2, 1)'),
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: isMobile ? '80vw' : 'var(--noa-right-panel-width, 310px)',
              maxWidth: isMobile ? '320px' : undefined,
            }}
            className="flex h-full min-h-0 shrink-0"
          >
            {!isMobile && (
              <div
                className="w-1.5 bg-transparent cursor-col-resize absolute left-0 top-0 bottom-0 z-20"
                onMouseDown={() => setIsDraggingRightPanel(true)}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize right panel"
                aria-valuenow={Math.round(rightPanelWidth)}
                aria-valuemin={310}
                aria-valuemax={480}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeRightPanelWidth(16); }
                  if (e.key === 'ArrowRight') { e.preventDefault(); nudgeRightPanelWidth(-16); }
                }}
              />
            )}
            {hasMountedRightPanel && <div className="flex-1 min-h-0 overflow-hidden" data-noa-right-panel-content>
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
                  // Stays true while the panel is closed so the strip can play
                  // its slide-out; TopBar drives the open/closed transform.
                  tabsInTitlebar={!isMobile && !isFocusMode}
                />
              </Suspense>
              </ErrorBoundary>
            </div>}
          </div>
        </div>
      </div>
      {saveError && (
        <div className="fixed bottom-4 right-4 z-50 border border-[#EC9A3C]/40 bg-[#F9F9F7] px-4 py-3 max-w-sm font-redaction rounded-md noa-floating-panel">
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
        <div className="fixed bottom-4 left-4 z-50 border border-[#CC7D5E]/60 bg-[#F9F9F7] px-4 py-2.5 max-w-sm font-redaction rounded-md noa-floating-panel">
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
        <div className="fixed bottom-20 right-4 z-50 border border-[#2D2D2B]/20 bg-[#EFEAE3] px-4 py-3 max-w-xs font-redaction noa-floating-panel">
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
      {commandPalette.isOpen && <CommandPaletteDialog palette={commandPalette} />}
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
            onRenameWorkspace={setWorkspaceName}
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
        <NavigationConflictDialog
          title={navigationConflict.title}
          noteIds={navigationConflict.noteIds}
          notes={notes}
          folderNameById={folderNameById}
          onSelect={(id) => {
            navigateById(id);
            setNavigationConflict(null);
          }}
          onClose={() => setNavigationConflict(null)}
        />
      )}
      {pendingTemplateNoteId && (
        <TemplatePickerDialog
          noteTitle={notes.find(n => n.id === pendingTemplateNoteId)?.title ?? 'New Note'}
          dateFormat={settings.dailyNotes.dateFormat}
          userTemplates={settings.templates?.userTemplates ?? []}
          onApply={(content) => handleUpdateNote(pendingTemplateNoteId, content)}
          onClose={() => setPendingTemplateNoteId(null)}
        />
      )}
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
    {loadError && (
      <RecoveryDialog
        message={loadError.message}
        onRetry={retryInitialization}
        onImportBackup={(file) => { void importBackupFromRecovery(file); }}
        onReset={() => { void resetWorkspaceFromRecovery(); }}
      />
    )}
    </>
  );
}
