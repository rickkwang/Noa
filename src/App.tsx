/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorFocusRequest } from './components/Editor';
import { ErrorBoundary } from './components/ErrorBoundary';
import RecoveryDialog from './components/RecoveryDialog';
import type { SettingsTab } from './components/settings/SettingsSidebar';
import Sidebar from './components/Sidebar';
import ThemeInjector from './components/ThemeInjector';
import TopBar from './components/TopBar';
import type { RightTab } from './constants/rightTabs';
import { STORAGE_KEYS } from './constants/storageKeys';
import { useAutoBackup } from './hooks/useAutoBackup';
import { useCommandPalette } from './hooks/useCommandPalette';
import { useFileSync } from './hooks/useFileSync';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useGlobalTasks } from './hooks/useGlobalTasks';
import { PANEL_MAX_WIDTH, RIGHT_PANEL_MIN_WIDTH, SIDEBAR_MIN_WIDTH, useLayout } from './hooks/useLayout';
import { useNotes } from './hooks/useNotes';
import { usePaneBadges } from './hooks/usePaneBadges';
import { useGlobalScrollingClass } from './hooks/useScrollingClass';
import { useSettings } from './hooks/useSettings';
import { useSidebarPreview } from './hooks/useSidebarPreview';
import { useTabs } from './hooks/useTabs';
import { useVaultOperations } from './hooks/useVaultOperations';
import { LOCAL_DATA_BOUNDARY_COPY } from './lib/userFacingCopy';

const Editor = lazy(() => import('./components/Editor'));
const RightPanel = lazy(() => import('./components/RightPanel'));
const SettingsModal = lazy(() => import('./components/settings/SettingsModal'));
const EmptyState = lazy(() => import('./components/emptyState/EmptyState'));
const CommandPaletteDialog = lazy(() => import('./components/CommandPaletteDialog'));
const NavigationConflictDialog = lazy(() => import('./components/NavigationConflictDialog'));
const TemplatePickerDialog = lazy(() => import('./components/TemplatePickerDialog'));
const VaultOnboardingDialog = lazy(() => import('./components/VaultOnboardingDialog'));

// The preview's elevation (index.css .noa-sidebar-preview-shell, the
// rounded-r corner, the --bg-primary floor) drops on the same 500ms clock as
// the promotion spacer, so the panel settles while the editor makes room.
// Stable identity for "no card lit" so a collapsed column does not hand the
// titlebar a fresh array on every render.
const NO_PANES: readonly RightTab[] = [];
const SIDEBAR_PROMOTION_EDGE_CLOCK = '500ms ease-in-out';
const SIDEBAR_PROMOTION_SURFACE_TRANSITION = [
  `box-shadow ${SIDEBAR_PROMOTION_EDGE_CLOCK}`,
  `border-radius ${SIDEBAR_PROMOTION_EDGE_CLOCK}`,
  `background-color ${SIDEBAR_PROMOTION_EDGE_CLOCK}`,
].join(', ');

// The sidebar's dock motion, which the right column rides when a sidebar toggle
// changes its width: symmetric ease-in-out, so opening and closing read as one
// motion played forwards and back.
const RIGHT_PANEL_TOGGLE_MS = 500;
const RIGHT_PANEL_TOGGLE_CLOCK = `${RIGHT_PANEL_TOGGLE_MS}ms ease-in-out`;

export default function App() {
  useGlobalScrollingClass();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
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
  const [vaultOnboardingDismissed, setVaultOnboardingDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.VAULT_ONBOARDING_SEEN) === 'true';
    } catch {
      return false;
    }
  });
  const [vaultOnboardingBusy, setVaultOnboardingBusy] = useState(false);
  // Separate from vaultOnboardingBusy on purpose: that latch force-shows the
  // onboarding dialog, which must not appear while the footer drives a switch.
  const [vaultActionBusy, setVaultActionBusy] = useState(false);
  const [vaultOnboardingError, setVaultOnboardingError] = useState<string | null>(null);
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
    enteringTabIds,
    enteringFromTabIds,
    closingTabIds,
    tabLimitWarning,
    openTabForNote,
    closeTabById,
    handleTabClose,
    handleTabReorder,
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
    vaultHydrationPending,
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

  // lib/fileSystemStorage's isFileSystemSupported() is off-limits to App.tsx
  // (dependency-cruiser), so probe the picker the same way the rest of the file does.
  const canPickVaultFolder = typeof window.showDirectoryPicker === 'function';

  const dismissVaultOnboarding = useCallback(() => {
    setVaultOnboardingDismissed(true);
    try { localStorage.setItem(STORAGE_KEYS.VAULT_ONBOARDING_SEEN, 'true'); } catch { /* private mode */ }
  }, []);

  const connectVaultFromOnboarding = useCallback(() => {
    setVaultOnboardingBusy(true);
    setVaultOnboardingError(null);
    void connect()
      .then(() => dismissVaultOnboarding())
      .catch((error: unknown) => {
        // Picker dismissal is not a failure — leave the dialog in its initial state.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setVaultOnboardingError(error instanceof Error && error.message ? error.message : 'Could not open that folder.');
      })
      .finally(() => setVaultOnboardingBusy(false));
  }, [connect, dismissVaultOnboarding]);

  // vaultHydrationPending covers the persisted-handle restore window (it starts
  // true and clears only after bootstrap resolves), so vault users never see a
  // flash. The busy latch keeps the dialog mounted while connect() runs —
  // otherwise a picker cancel (syncStatus -> 'error') would unmount it.
  const showVaultOnboarding = (isDataReady
    && canPickVaultFolder
    && !fsHandle
    && !vaultHydrationPending
    && !vaultOnboardingDismissed) || vaultOnboardingBusy;

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

  const [editorFocusRequest, setEditorFocusRequest] = useState<EditorFocusRequest | null>(null);
  const editorFocusRequestIdRef = useRef(0);
  const requestEditorFocus = useCallback((noteId: string, target: EditorFocusRequest['target']) => {
    editorFocusRequestIdRef.current += 1;
    setEditorFocusRequest({ noteId, target, requestId: editorFocusRequestIdRef.current });
  }, []);
  const handleEditorFocusRequestHandled = useCallback((requestId: number) => {
    setEditorFocusRequest(current => current?.requestId === requestId ? null : current);
  }, []);

  const handleCreateNote = useCallback((folderId: string, initialContent?: string) => {
    const targetFolder = folders.find((folder) => folder.id === folderId);
    if (blockVaultCacheWrite(targetFolder?.origin === 'vault')) return '';
    const createdId = _handleCreateNote(folderId, initialContent);
    // New notes remain Noa-owned; only vault-origin notes write through to disk.
    const userTemplates = settings.templates?.userTemplates ?? [];
    if (createdId && userTemplates.length > 0 && !initialContent) {
      waitingForTemplateRef.current = true;
    } else if (createdId) {
      // Every "new note" entry point lands here. Without this the keystrokes
      // that follow Cmd+N went to <body> and were lost. The template picker,
      // when it opens, takes focus itself, so it is left alone.
      requestEditorFocus(createdId, 'title');
    }
    return createdId;
  }, [_handleCreateNote, blockVaultCacheWrite, folders, requestEditorFocus, settings.templates?.userTemplates]);

  const handleSaveNoteGuarded = useCallback((note: Parameters<typeof handleSaveNote>[0], update?: Parameters<typeof handleSaveNote>[1]) => {
    if (blockVaultCacheWrite(note.origin === 'vault')) return;
    handleSaveNote(note, update);
  }, [blockVaultCacheWrite, handleSaveNote]);

  const handleImportNoteGuarded = useCallback((...args: Parameters<typeof handleImportNote>) => {
    const folderId = args[2];
    const targetFolder = folderId ? folders.find((folder) => folder.id === folderId) : undefined;
    if (blockVaultCacheWrite(targetFolder?.origin === 'vault')) return;
    handleImportNote(...args);
  }, [blockVaultCacheWrite, folders, handleImportNote]);

  const handleOpenDailyNoteGuarded = useCallback((targetDate?: string) => {
    if (!isDataReady) return;
    const opened = handleOpenDailyNote(targetDate);
    // Only the explicit "today" actions (shortcut, palette, sidebar button)
    // mean "I'm about to write". A calendar click (passes a date) is often just a look back, so it keeps focus.
    if (!opened || targetDate !== undefined) return;
    // Only a note this call created may be edited to make its template slot
    // usable (a space after an empty `- [ ]`). An existing note is focused
    // without being edited: opening it must not bump its modified time.
    requestEditorFocus(opened.noteId, opened.created ? 'slot' : opened.noteId === activeNoteId ? 'keep' : 'open');
  }, [activeNoteId, handleOpenDailyNote, isDataReady, requestEditorFocus]);

  const handleToggleTaskGuarded = useCallback((task: Parameters<typeof handleToggleTask>[0]) => {
    const note = notesRef.current.find((item) => item.id === task.noteId);
    if (blockVaultCacheWrite(note?.origin === 'vault')) return;
    const toggled = handleToggleTask(task);
    // Write through to the vault, or the next disk-authoritative scan reverts it.
    if (toggled) syncNoteOnUpdate(toggled.noteId, toggled.content);
  }, [blockVaultCacheWrite, handleToggleTask, syncNoteOnUpdate]);

  const restoreSnapshotGuarded = useCallback(async (snapshot: Parameters<typeof restoreSnapshot>[0]) => {
    const note = notesRef.current.find((item) => item.id === snapshot.noteId);
    if (blockVaultCacheWrite(note?.origin === 'vault')) return;
    await restoreSnapshot(snapshot);
    // Write through to the vault, or the next disk-authoritative scan reverts it.
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

  // Explicit "no vault" choice: don't re-prompt onboarding.
  const handleDisconnectFolderAndDismissOnboarding = useCallback(async () => {
    await handleDisconnectFolder();
    dismissVaultOnboarding();
  }, [handleDisconnectFolder, dismissVaultOnboarding]);

  // Switching vaults is disconnect-then-connect, never a bare connect(): that would skip
  // handleDisconnectFolder's guards and merge into the old vault's cache. A cancelled picker leaves no vault attached.
  const handleSwitchVaultFolder = useCallback(async () => {
    setVaultActionBusy(true);
    try {
      await handleDisconnectFolder();
      await connect();
      dismissVaultOnboarding();
    } catch (error) {
      // Picker dismissal is the expected "changed my mind" path; the vault is
      // already disconnected by then, which the confirmation step spelled out.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // A disconnect failure has already set this to the same message, so this
      // is a no-op there and the real report for a connect() failure.
      setSaveError(error instanceof Error && error.message ? error.message : 'Could not open that folder.');
    } finally {
      setVaultActionBusy(false);
    }
  }, [connect, dismissVaultOnboarding, handleDisconnectFolder, setSaveError]);

  const handleConnectVaultFolder = useCallback(async () => {
    setVaultActionBusy(true);
    try {
      await connect();
      dismissVaultOnboarding();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setSaveError(error instanceof Error && error.message ? error.message : 'Could not open that folder.');
    } finally {
      setVaultActionBusy(false);
    }
  }, [connect, dismissVaultOnboarding, setSaveError]);

  const handleDisconnectVaultFolder = useCallback(async () => {
    setVaultActionBusy(true);
    try {
      await handleDisconnectFolderAndDismissOnboarding();
    } catch {
      // handleDisconnectFolder already surfaced this through setSaveError.
    } finally {
      setVaultActionBusy(false);
    }
  }, [handleDisconnectFolderAndDismissOnboarding]);

  const {
    isMobile,
    isSidebarOpen,
    setIsSidebarOpen,
    isRightPanelOpen,
    setIsRightPanelOpen,
    openPanes,
    togglePane,
    showOnlyPane,
    expandedPane,
    toggleExpandedPane,
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

  const [editorLineJumpRequest, setEditorLineJumpRequest] = useState<{
    noteId: string;
    lineIndex: number;
    requestId: number;
  } | null>(null);
  const editorLineJumpRequestIdRef = useRef(0);

  const {
    isSidebarPreviewOpen,
    isSidebarPreviewClosing,
    isSidebarPreviewSettling,
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
    if (!isSearchOpen || isFocusMode) {
      // The field stays mounted while collapsed (so open and close animate
      // symmetrically), so it can still hold focus after it is hidden.
      if (document.activeElement === searchInputRef.current) searchInputRef.current?.blur();
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      // preventScroll: the field is still mid-expand and sits outside its
      // clipped shell, so a scrolling focus would drag the search icon
      // sideways for a frame.
      searchInputRef.current?.focus({ preventScroll: true });
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isFocusMode, isSearchOpen]);

  // Keep the graph/tasks bundle out of the first render: mount next frame if restored open, else while idle.
  // Once mounted it stays mounted, so every open is instant.
  const isPaneExpanded = expandedPane !== null && !isFocusMode;
  const isRightPanelFloating = isPaneExpanded;
  const rightPanelColumnWidth = isPaneExpanded
    // 1px short of the sidebar: its divider sits on that pixel, and covering it
    // leaves the sidebar with no edge.
    ? (isSidebarOpen ? 'calc(100vw - var(--noa-sidebar-width, 325px) - 1px)' : '100vw')
    : 'var(--noa-right-panel-width, 340px)';
  // Column width changes with the sidebar toggle must ride the sidebar's 500ms clock or the edges part mid-motion.
  // Set during render so the same commit that flips the sidebar carries the transition.
  const [prevSidebarOpen, setPrevSidebarOpen] = useState(isSidebarOpen);
  const [isSidebarMoving, setIsSidebarMoving] = useState(false);
  if (prevSidebarOpen !== isSidebarOpen) {
    setPrevSidebarOpen(isSidebarOpen);
    setIsSidebarMoving(true);
  }
  useEffect(() => {
    if (!isSidebarMoving) return;
    const timer = window.setTimeout(() => setIsSidebarMoving(false), RIGHT_PANEL_TOGGLE_MS + 20);
    return () => window.clearTimeout(timer);
  }, [isSidebarMoving, isSidebarOpen]);
  const rightPanelFollowsSidebar = isSidebarMoving && !isMobile && !isDraggingSidebar && !isDraggingRightPanel;

  const [hasMountedRightPanel, setHasMountedRightPanel] = useState(false);
  useEffect(() => {
    if (!isLoaded || hasMountedRightPanel) return;
    if (isRightPanelOpen) {
      const frame = window.requestAnimationFrame(() => setHasMountedRightPanel(true));
      return () => window.cancelAnimationFrame(frame);
    }
    // Restored closed: mount behind the zero-width mask while idle; warming the module alone still shows "Loading panel…" on first open.
    if (typeof window.requestIdleCallback !== 'function') {
      const timer = window.setTimeout(() => setHasMountedRightPanel(true), 2000);
      return () => window.clearTimeout(timer);
    }
    const id = window.requestIdleCallback(() => setHasMountedRightPanel(true), { timeout: 5000 });
    return () => window.cancelIdleCallback(id);
  }, [hasMountedRightPanel, isLoaded, isRightPanelOpen]);

  // The veil's entry animation (@starting-style) must not fire on the first render,
  // or a restart with the sidebar open would sweep the column open. Wait for isLoaded
  // (past the skeleton) and two frames (one rAF can land inside the commit's paint).
  const [hasPaintedSidebarMaterial, setHasPaintedSidebarMaterial] = useState(false);
  useEffect(() => {
    if (!isLoaded) return;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setHasPaintedSidebarMaterial(true));
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [isLoaded]);

  // Warm the lazy settings chunk while idle so the first open doesn't spend a
  // beat fetching it before anything renders (its Suspense fallback is null).
  // The right panel rides along, so the idle mount below (when it was
  // restored closed) finds its chunk already fetched.
  useEffect(() => {
    if (typeof window.requestIdleCallback !== 'function') return;
    const id = window.requestIdleCallback(
      () => {
        void import('./components/settings/SettingsModal');
        void import('./components/RightPanel');
      },
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
    // Switch immediately and persist the outgoing note in the background; awaiting IndexedDB here stutters tab switches.
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
  const paneBadges = usePaneBadges(notes, folders, activeNoteId, globalTasks);
  const activeNote = useMemo(() => activeNoteId ? notes.find(n => n.id === activeNoteId) : undefined, [activeNoteId, notes]);

  // Orphan activeNoteId (deleted in another window): clear selection and toast, or edits drop silently.
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

  const handleRightPanelNavigate = useCallback((id: string, lineIndex?: number) => {
    navigateById(id);
    if (lineIndex !== undefined) {
      editorLineJumpRequestIdRef.current += 1;
      setEditorLineJumpRequest({ noteId: id, lineIndex, requestId: editorLineJumpRequestIdRef.current });
      setEditorViewMode('edit');
    }
    if (isMobile) setIsRightPanelOpen(false);
  }, [navigateById, isMobile, setEditorViewMode, setIsRightPanelOpen]);

  const handleEditorLineJumpHandled = useCallback((requestId: number) => {
    setEditorLineJumpRequest(current => current?.requestId === requestId ? null : current);
  }, []);

  // On a phone the sidebar is an overlay over the editor. Creating or opening
  // a note from it must close it, as selecting one does, or the editor focus
  // that follows lands on a field the sidebar is covering.
  const handleSidebarCreateNote = useCallback((folderId: string, initialContent?: string) => {
    handleCreateNote(folderId, initialContent);
    if (isMobile) setIsSidebarOpen(false);
  }, [handleCreateNote, isMobile, setIsSidebarOpen]);

  const handleSidebarOpenDailyNote = useCallback((targetDate?: string) => {
    handleOpenDailyNoteGuarded(targetDate);
    if (isMobile) setIsSidebarOpen(false);
  }, [handleOpenDailyNoteGuarded, isMobile, setIsSidebarOpen]);

  const handleSidebarSelectNote = useCallback((id: string) => {
    // Switch synchronously so the editor and tab animation aren't gated on IndexedDB; flush outgoing saves in background.
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
    return desktop.lifecycle.onBeforeQuit(async () => {
      await flushAllPendingSaves(undefined, true);
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
    // Theme background only: a placeholder layout here goes stale whenever the
    // real one changes, and the load window is short enough not to need one.
    return (
      <>
      <ThemeInjector settings={settings} />
      <div className="h-screen w-screen" style={{ backgroundColor: 'var(--bg-primary, #FCFCFB)' }} />
      </>
    );
  }

  // Docked sidebar collapses under a mask (its box shrinks over stationary content). True = mask closed.
  const isSidebarContentMasked = !isMobile && !isPromotingSidebarPreview && !isSidebarPreviewOpen && (isFocusMode || !isSidebarOpen);

  // True only when the docked sidebar's own width is moving. Opt-in by design: a state added later
  // snaps by default, since other edge moves would otherwise make the titlebar hairline lag behind the edge.
  const isSidebarDockMotionLive = !isMobile
    && !isSidebarPreviewOpen
    && !isPromotingSidebarPreview
    && !isSettlingSidebarPromotionClose
    && !isSidebarPreviewSettling
    && !isDraggingSidebar;

  return (
    <>
    <div
      inert={loadError ? true : undefined}
      aria-hidden={loadError ? true : undefined}
      className="noa-app-shell h-screen w-screen flex flex-col bg-[#F9F9F7] text-[#2D2D2B] font-redaction overflow-hidden relative selection:bg-[#CC7D5E] selection:text-white"
      data-sidebar-dock-motion={isSidebarDockMotionLive ? 'true' : undefined}
      data-layout-motion={!isMobile && isSidebarMoving ? 'true' : undefined}
      data-sidebar-moving={!isMobile && isSidebarMoving ? 'true' : undefined}
      data-sidebar-material-painted={hasPaintedSidebarMaterial ? 'true' : undefined}
      style={{
        '--noa-titlebar-search-extra': isSearchOpen ? '9rem' : '0px',
        '--noa-sidebar-material-width': isSidebarOpen && !isMobile && !isFocusMode
          ? 'var(--noa-sidebar-width, 325px)'
          : '0px',
        // Not transitioned: veils in index.css animate transform from this variable on the compositor instead.
        transition: 'none',
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
            // so both edges travel the same distance on the same curve.
            left: isPromotingSidebarPreview
              ? undefined
              : isSidebarOpen ? 'var(--noa-sidebar-width, 325px)' : '0px',
            width: '1px',
            backgroundColor: 'var(--divider-subtle, #E6E2DA)',
            opacity: isSidebarOpen ? 1 : 0,
            // Direct toggle follows the sidebar edge; during preview promotion it stays fixed and fades in with the shadow.
            transition: isPromotingSidebarPreview
              ? `opacity ${SIDEBAR_PROMOTION_EDGE_CLOCK}`
              : isDraggingSidebar
              ? 'none'
              : `left 500ms ease-in-out, opacity 0ms linear ${isSidebarOpen ? '0ms' : '500ms'}`,
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
          className={`absolute inset-y-0 left-0 overflow-hidden ${isSidebarPreviewOpen ? 'noa-sidebar-preview-shell noa-sidebar-preview-motion z-40 rounded-r-[14px]' : isPromotingSidebarPreview ? 'pointer-events-none z-40' : 'pointer-events-none z-10'}`}
          style={{
            width: isSidebarOpen || isSidebarPreviewOpen || isPromotingSidebarPreview
              ? 'var(--noa-sidebar-width, 325px)'
              : '0px',
            backgroundColor: isSidebarPreviewOpen
              ? 'var(--bg-primary, #FCFCFB)'
              : 'var(--bg-sidebar, #F4F4F2)',
            opacity: isSidebarPreviewOpen ? undefined : isSidebarOpen || isPromotingSidebarPreview ? 1 : 0,
            // Promotion eases the preview's elevation on the spacer's clock so it settles into the dock.
            // isSidebarPreviewSettling suppresses the 500ms collapse this surface would otherwise play on dismiss.
            transition: isSidebarPreviewOpen
              ? undefined
              : isPromotingSidebarPreview
                ? SIDEBAR_PROMOTION_SURFACE_TRANSITION
              : isSettlingSidebarPromotionClose || isDraggingSidebar || isSidebarPreviewSettling
                ? 'none'
                : `width 500ms ease-in-out, opacity 0ms linear ${isSidebarOpen ? '0ms' : '500ms'}`,
          }}
        />
      )}
      {!isFocusMode && <TopBar
        settings={settings}
        onToggleSidebar={toggleSidebar}
        sidebarToggleRef={sidebarToggleRef}
        onSidebarPreviewEnter={openSidebarPreview}
        onSidebarPreviewLeave={scheduleSidebarPreviewClose}
        onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
        isSidebarOpen={isSidebarOpen}
        isSidebarMaterialActive={isSidebarMaterialActive}
        isRightPanelOpen={isRightPanelOpen}
        // Also while the column follows a sidebar toggle: a wide graph's width
        // is capped against the sidebar, so its edge moves on that clock too.
        rightPanelEdgeTransition={rightPanelFollowsSidebar ? `right ${RIGHT_PANEL_TOGGLE_CLOCK}` : undefined}
        activePanes={isRightPanelOpen ? openPanes : NO_PANES}
        onTogglePane={togglePane}
        paneBadges={paneBadges}
        isRightPanelCovering={isRightPanelFloating}
        isMobile={isMobile}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isSearchOpen={isSearchOpen}
        onToggleSearch={toggleSearch}
        onCloseSearch={() => {
          setSearchQuery('');
          setIsSearchOpen(false);
        }}
        // Blur fires on mousedown, before click; tearing results down there would swallow the click. Only explicit exits clear the search.
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

        {/* !isFocusMode in the condition itself: useSidebarPreview resets the
            phase from a passive effect, which lands a tick after the commit
            that enters focus mode. The spacer must be gone in that commit. */}
        {!isMobile && !isFocusMode && isPromotingSidebarPreview && (
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
          data-sidebar-promoting={isPromotingSidebarPreview ? 'true' : undefined}
          onMouseEnter={isSidebarPreviewOpen ? cancelSidebarPreviewClose : undefined}
          onMouseLeave={isSidebarPreviewOpen ? scheduleSidebarPreviewClose : undefined}
          onTransitionEnd={finishSidebarDockMotion}
          onTransitionCancel={finishSidebarDockMotion}
          className={`flex shrink-0 overflow-hidden ${isMobile ? 'noa-sidebar-surface absolute inset-y-0 left-0 z-40 shadow-xl' : isSidebarPreviewOpen ? 'noa-sidebar-preview-motion absolute inset-y-0 z-50 rounded-br-[14px]' : isPromotingSidebarPreview ? 'absolute inset-y-0 left-0 z-50' : 'relative z-20'}`}
          style={{
            // Docked sidebar never moves: its width is the mask, clipping a fixed-width child at the left edge.
            width: isMobile
              ? '80%'
              : isSidebarContentMasked ? '0px' : 'var(--noa-sidebar-width, 325px)',
            maxWidth: isMobile ? '320px' : undefined,
            // Both float at the app's left edge; docked, the box is in flow and
            // takes its own position.
            left: !isMobile && (isSidebarPreviewOpen || isPromotingSidebarPreview)
              ? '0px'
              : undefined,
            transform: isMobile
              ? (isFocusMode || !isSidebarOpen ? 'translateX(-100%)' : 'translateX(0)')
              : undefined,
            transition: isSidebarPreviewOpen
              ? undefined
              : isPromotingSidebarPreview
                ? `border-radius ${SIDEBAR_PROMOTION_EDGE_CLOCK}`
              : isDraggingSidebar || isPromotingSidebarPreview || isSettlingSidebarPromotionClose || isSidebarPreviewSettling
                ? 'none'
                : (isMobile ? 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)' : 'width 500ms ease-in-out'),
            minWidth: 0,
          }}
        >
          <div
            data-sidebar-content-layer="true"
            style={{
              width: isMobile ? '80vw' : 'var(--noa-sidebar-width, 325px)',
              maxWidth: isMobile ? '320px' : undefined,
              // Dim on a slightly shorter curve so content dissolves before the edge reaches it.
              opacity: isSidebarContentMasked ? 0 : 1,
              // Width eases with the variable too, or content spends the motion clipped short of its box.
              transition: isMobile
                || isDraggingSidebar
                || isSidebarPreviewOpen
                || isPromotingSidebarPreview
                || isSettlingSidebarPromotionClose
                || isSidebarPreviewSettling
                ? 'none'
                : 'opacity 500ms ease-in-out, width 500ms ease-in-out',
            }}
            className="flex h-full shrink-0"
          >
            <div className="flex-1 min-h-0 overflow-hidden">
              <Sidebar
                notes={notes}
                folders={folders}
                tasks={globalTasks}
                searchQuery={searchQuery}
                activeNoteId={activeNoteId}
                onSelectNote={handleSidebarSelectNote}
                onCreateNote={handleSidebarCreateNote}
                onDeleteNote={handleDeleteNote}
                onRenameNote={handleRenameNote}
                onMoveNote={handleMoveNote}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onOpenDailyNote={handleSidebarOpenDailyNote}
                dailyNotesEnabled={settings.corePlugins.dailyNotes}
                vault={{
                  workspaceName,
                  vaultName: fsHandle?.name ?? null,
                  syncStatus,
                  lastSyncAt: fsLastSyncAt,
                  syncError: fsSyncError,
                  busy: vaultActionBusy,
                  // Undefined on browsers without the File System Access API, so
                  // the menu drops the vault actions instead of offering dead ones.
                  onConnectVault: canPickVaultFolder
                    ? () => { void handleConnectVaultFolder(); }
                    : undefined,
                  onSwitchVault: canPickVaultFolder
                    ? () => { void handleSwitchVaultFolder(); }
                    : undefined,
                  onDisconnectVault: canPickVaultFolder
                    ? () => { void handleDisconnectVaultFolder(); }
                    : undefined,
                  onRetrySync: retry,
                  onOpenWorkspaceSettings: () => {
                    setSettingsInitialTab('workspace');
                    setIsSettingsOpen(true);
                  },
                  onOpenSettings: () => {
                    setSettingsInitialTab(undefined);
                    setIsSettingsOpen(true);
                  },
                }}
                onImportNote={handleImportNoteGuarded}
                // Both replace the file tree with a result list, so the query must be visible.
                onSearchTag={(tag) => {
                  setSearchQuery(`tag:${tag}`);
                  setIsSearchOpen(true);
                }}
                onSearchQuery={(query) => {
                  setSearchQuery(query);
                  setIsSearchOpen(Boolean(query));
                }}
                onClearSearch={() => setSearchQuery('')}
                caseSensitive={settings.search.caseSensitive}
                fuzzySearch={settings.search.fuzzySearch}
                dateFormat={settings.dailyNotes.dateFormat}
              />
            </div>
            {!isMobile && (
              <div
                className="noa-resize-handle w-1.5 bg-transparent cursor-col-resize absolute right-0 top-0 bottom-0 z-20"
                data-edge="right"
                data-dragging={isDraggingSidebar ? 'true' : undefined}
                onMouseDown={handleSidebarResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar"
                aria-valuenow={Math.round(sidebarWidth)}
                aria-valuemin={SIDEBAR_MIN_WIDTH}
                aria-valuemax={PANEL_MAX_WIDTH}
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
                // Two panes cannot both be readable at phone width. Split is
                // shown as edit there without overwriting the saved choice.
                viewMode={isMobile && editorViewMode === 'split' ? 'edit' : editorViewMode}
                setViewMode={setEditorViewMode}
                allowSplit={!isMobile}
                settings={settings}
                tabs={openTabs}
                enteringTabIds={enteringTabIds}
                enteringFromTabIds={enteringFromTabIds}
                closingTabIds={closingTabIds}
                onTabChange={handleTabChange}
                onTabClose={handleTabClose}
                onTabReorder={handleTabReorder}
                onNewTab={handleNewTab}
                onTabEnterComplete={handleTabEnterComplete}
                onTabCloseAnimationComplete={handleTabCloseAnimationComplete}
                liftTabStrip={!isMobile && !isFocusMode}
                reserveTitlebarTraffic={!isMobile && !isFocusMode && !isSidebarOpen}
                reserveTitlebarActions={!isMobile && !isFocusMode}
                onRestoreSnapshot={restoreSnapshotGuarded}
                readOnly={(vaultCacheReadOnly || authoritativeSyncInProgress || hasPendingStructuralOperations) && activeNote?.origin === 'vault'}
                attachmentMutationsDisabled={!isDataReady || activeNote?.origin === 'vault'}
                lineJumpRequest={editorLineJumpRequest}
                onLineJumpHandled={handleEditorLineJumpHandled}
                focusRequest={editorFocusRequest}
                onFocusRequestHandled={handleEditorFocusRequestHandled}
              />
            ) : (
              // Its own boundary: the editor's "Loading editor…" fallback
              // would flash for a pane that has no editor in it.
              <Suspense fallback={<div className="flex-1" />}>
                {isDataReady ? (
                  <EmptyState
                    scene={settings.appearance.emptyStateScene}
                    theme={settings.appearance.theme}
                    noteCount={notes.length}
                    dailyNotesEnabled={settings.corePlugins.dailyNotes}
                    onNewNote={() => handleCreateNote(primaryNoaFolderId)}
                    onTodayNote={() => handleOpenDailyNoteGuarded()}
                    onGoTo={() => commandPalette.setIsOpen(true)}
                  />
                ) : <div className="flex-1" />}
              </Suspense>
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
          // Exactly one position class: `relative` + `absolute` together let Tailwind's source order keep the overlay in flow.
          // Desktop lifts over the 44px titlebar; expanded goes out of flow over the editor (stays below the titlebar when the sidebar is closed).
          className={`flex justify-end shrink-0 min-h-0 overflow-hidden ${
            isMobile
              ? 'absolute inset-y-0 right-0 z-40 shadow-xl'
              : isRightPanelFloating
                ? `absolute bottom-0 right-0 z-[35] ${isFocusMode ? 'top-0' : isPaneExpanded && !isSidebarOpen ? '-top-2' : '-top-11'}`
                : `relative z-[35] ${isFocusMode ? '' : '-mt-11'}`
          }`}
          data-right-panel-column="true"
          style={{
            // Desktop: closed is a zero-width column, shown and hidden at once.
            width: isMobile
              ? '80%'
              : !isRightPanelFloating && (isFocusMode || !isRightPanelOpen) ? '0px' : rightPanelColumnWidth,
            maxWidth: isMobile ? '320px' : undefined,
            opacity: !isMobile && (isFocusMode || !isRightPanelOpen) ? 0 : undefined,
            transform: isMobile
              ? (isFocusMode || !isRightPanelOpen ? 'translateX(100%)' : 'translateX(0)')
              : undefined,
            // Only the phone drawer slides; on desktop the column snaps except
            // while it follows a sidebar toggle.
            transition: isMobile && !isDraggingRightPanel
              ? 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)'
              : rightPanelFollowsSidebar
                ? `width ${RIGHT_PANEL_TOGGLE_CLOCK}, top ${RIGHT_PANEL_TOGGLE_CLOCK}`
                : 'none',
            minWidth: 0,
            // Electron resolves drag regions by geometry, not z-order: without this lift the titlebar swallows clicks on the cards' top 44px.
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          <div
            style={{
              width: isMobile ? '80vw' : rightPanelColumnWidth,
              maxWidth: isMobile ? '320px' : undefined,
              transition: rightPanelFollowsSidebar
                ? `width ${RIGHT_PANEL_TOGGLE_CLOCK}`
                : undefined,
            }}
            className="flex h-full min-h-0 shrink-0"
          >
            {/* No handle while a card is expanded: the width is not the
                user's to set there. */}
            {!isMobile && !isRightPanelFloating && (
              <div
                className="noa-resize-handle group w-2 bg-transparent cursor-col-resize absolute left-0 top-0 bottom-0 z-20 flex items-center"
                title="Resize"
                data-edge="left"
                data-dragging={isDraggingRightPanel ? 'true' : undefined}
                onMouseDown={() => setIsDraggingRightPanel(true)}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize right panel"
                aria-valuenow={Math.round(rightPanelWidth)}
                aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
                aria-valuemax={PANEL_MAX_WIDTH}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeRightPanelWidth(16); }
                  if (e.key === 'ArrowRight') { e.preventDefault(); nudgeRightPanelWidth(-16); }
                }}
              >
                {/* The same grip as the one between two cards (RightPanel): the
                    column has no divider line any more, so this is the only
                    sign that its edge can be dragged. It sits in the 8px gutter
                    beside the cards, against the editor side: centred there it
                    was 2px off the card and read as stuck to it. */}
                <span
                  aria-hidden="true"
                  className={`ml-px h-9 w-[3px] rounded-full bg-[var(--text-primary,#2D2D2B)] transition-opacity duration-150 ${isDraggingRightPanel ? 'opacity-70' : 'opacity-0 group-hover:opacity-50 group-focus-visible:opacity-50'}`}
                />
              </div>
            )}
            {hasMountedRightPanel && <div className="flex-1 min-h-0 overflow-hidden" data-noa-right-panel-content>
              <ErrorBoundary>
              <Suspense fallback={<div className="h-full flex items-center justify-center text-[#2D2D2B]/60 text-sm">Loading panel…</div>}>
                <RightPanel
                  tasks={globalTasks}
                  onToggleTask={handleToggleTaskGuarded}
                  onNavigateToNoteById={handleRightPanelNavigate}
                  activeNote={activeNote}
                  openPanes={openPanes}
                  onTogglePane={togglePane}
                  onShowOnlyPane={showOnlyPane}
                  badges={paneBadges}
                  single={isMobile}
                  expandedPane={isPaneExpanded ? expandedPane : null}
                  onToggleExpandPane={toggleExpandedPane}
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
      <div aria-label="Notifications" role="region" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm max-h-[calc(100vh-2rem)] overflow-y-auto pointer-events-none font-redaction">
        {saveError && (
          <div role="alert" className="pointer-events-auto border border-[var(--divider-subtle)] bg-[#F9F9F7] px-4 py-3 rounded-md noa-floating-panel">
            <div className="text-sm font-bold text-[#2D2D2B] mb-1">Action failed</div>
            <div className="text-xs text-[#2D2D2B]/70 leading-relaxed mb-3">{saveError}</div>
            <button
              onClick={clearSaveError}
              className="text-xs font-bold border border-[var(--divider-subtle)] px-3 py-1.5 text-[#2D2D2B] hover:bg-[#EFEAE3] transition-colors active:opacity-70 rounded"
            >
              Dismiss
            </button>
          </div>
        )}
        {externalUpdateNotice && (
          <div role="status" className="pointer-events-auto border border-[var(--divider-subtle)] bg-[#F9F9F7] px-4 py-3 rounded-md noa-floating-panel">
            <div className="text-sm font-bold text-[#2D2D2B] mb-1">Folder updated</div>
            <div className="text-xs text-[#2D2D2B]/70 leading-relaxed">{externalUpdateNotice}</div>
          </div>
        )}
        {fsSyncError && fsHandle && (
          <div role="alert" className="pointer-events-auto border border-[var(--divider-subtle)] bg-[#F9F9F7] px-4 py-3 rounded-md noa-floating-panel">
            <div className="text-sm font-bold text-[#2D2D2B] mb-1">Folder sync failed</div>
            <div className="text-xs text-[#2D2D2B]/70 leading-relaxed mb-3">
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
                className="text-xs font-bold border border-[var(--divider-subtle)] px-3 py-1.5 text-[#2D2D2B] hover:bg-[#EFEAE3] transition-colors active:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed rounded"
              >
                {needsReauth ? 'Reconnect Folder' : 'Retry Sync'}
              </button>
              {permissionRevoked && (
                <button
                  disabled={syncStatus === 'syncing'}
                  onClick={() => { void handleDisconnectFolderAndDismissOnboarding().catch(() => {}); }}
                  className="text-xs font-bold border border-[var(--divider-subtle)] px-3 py-1.5 text-[#2D2D2B] hover:bg-[#EFEAE3] transition-colors active:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed rounded"
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        )}
        {showStorageNotice && !showVaultOnboarding && (
          <div className="pointer-events-auto border border-[var(--divider-subtle)] bg-[#F9F9F7] px-4 py-3 rounded-md noa-floating-panel">
            <div className="text-sm font-bold text-[#2D2D2B] mb-1">Local storage only</div>
            <div className="text-xs text-[#2D2D2B]/70 leading-relaxed mb-3">
              {LOCAL_DATA_BOUNDARY_COPY}
            </div>
            <button
              onClick={() => {
                setShowStorageNotice(false);
                try { localStorage.setItem(STORAGE_KEYS.STORAGE_NOTICE_SEEN, '1'); } catch { /* quota exceeded */ }
              }}
              className="text-xs font-bold border border-[var(--divider-subtle)] px-3 py-1.5 rounded text-[#2D2D2B]/60 hover:text-[#2D2D2B] hover:bg-[#EFEAE3] transition-colors"
            >
              Got it
            </button>
          </div>
        )}
      </div>
      {commandPalette.isOpen && (
        <Suspense fallback={null}>
          <CommandPaletteDialog palette={commandPalette} />
        </Suspense>
      )}
      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            onClose={() => setIsSettingsOpen(false)}
            initialTab={settingsInitialTab}
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
            onDisconnectFs={handleDisconnectFolderAndDismissOnboarding}
            fsLastSyncAt={fsLastSyncAt}
            fsSyncError={fsSyncError}
            syncStatus={syncStatus}
            onRetryFsSync={retry}
            autoBackup={autoBackup}
          />
        </Suspense>
      )}
      {showVaultOnboarding && (
        <Suspense fallback={null}>
          <VaultOnboardingDialog
            connecting={vaultOnboardingBusy}
            error={vaultOnboardingError}
            onConnect={connectVaultFromOnboarding}
            onDismiss={dismissVaultOnboarding}
          />
        </Suspense>
      )}
      {navigationConflict && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
      {pendingTemplateNoteId && (
        <Suspense fallback={null}>
          <TemplatePickerDialog
            noteTitle={notes.find(n => n.id === pendingTemplateNoteId)?.title ?? 'New Note'}
            dateFormat={settings.dailyNotes.dateFormat}
            userTemplates={settings.templates?.userTemplates ?? []}
            onApply={(content) => handleUpdateNote(pendingTemplateNoteId, content)}
            onClose={() => setPendingTemplateNoteId(null)}
          />
        </Suspense>
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
        // Token pair, not the literal one: `bg-[#2D2D2B]` is not remapped, so
        // in dark mode it lands on the identically-coloured app background and
        // the toast disappears.
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[var(--text-primary,#2D2D2B)] text-[var(--bg-primary,#FCFCFB)] text-xs px-3 py-1.5 font-redaction pointer-events-none">
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
