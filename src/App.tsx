/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import BackupReminderBar from './components/BackupReminderBar';
import { parseTasksFromNotes } from './lib/taskParser';
import { useSettings } from './hooks/useSettings';
import { useNotes } from './hooks/useNotes';
import { useLayout } from './hooks/useLayout';
import { useFileSync } from './hooks/useFileSync';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useBackupReminder } from './hooks/useBackupReminder';
import { exportJsonSnapshot } from './hooks/useDataTransfer';
import { useCommandPalette } from './hooks/useCommandPalette';
import ThemeInjector from './components/ThemeInjector';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LOCAL_DATA_BOUNDARY_COPY } from './lib/userFacingCopy';

const Editor = lazy(() => import('./components/Editor'));
const RightPanel = lazy(() => import('./components/RightPanel'));
const SettingsModal = lazy(() => import('./components/settings/SettingsModal'));

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const recoveryImportInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Multi-tab state: list of open note IDs in tab order
  const OPEN_TABS_KEY = 'redaction-diary-open-tabs';
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const restoredOpenTabsRef = useRef(false);
  const [showStorageNotice, setShowStorageNotice] = useState(() =>
    !localStorage.getItem('redaction-storage-notice-seen')
  );
  const { settings, updateSettings } = useSettings();

  const {
    notes,
    folders,
    workspaceName,
    activeNoteId,
    setActiveNoteId,
    recentNoteIds,
    handleUpdateNote: _handleUpdateNote,
    handleRenameNote: _handleRenameNote,
    handleCreateNote: _handleCreateNote,
    handleImportNote,
    handleNavigateToNote,
    handleDeleteNote: _handleDeleteNote,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handleOpenDailyNote,
    handleToggleTask,
    handleImportData,
    loadError,
    saveError,
    clearSaveError,
    flushAllPendingSaves,
    retryInitialization,
    resetWorkspaceFromRecovery,
    importBackupFromRecovery,
    isLoaded,
  } = useNotes(settings);

  const ensureInitialNote = useCallback(() => handleOpenDailyNote(), [handleOpenDailyNote]);
  const {
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
  } = useFileSync({
    isLoaded,
    notes,
    folders,
    workspaceName,
    activeNoteId,
    ensureInitialNote,
    onImportData: handleImportData,
  });

  const handleUpdateNote = (id: string, content: string) => {
    _handleUpdateNote(id, content);
    syncNoteOnUpdate(id, content);
  };

  const handleRenameNote = (id: string, newTitle: string) => {
    _handleRenameNote(id, newTitle);
    syncNoteOnRename(id, newTitle);
  };

  const handleCreateNote = (folderId: string, initialContent?: string) => {
    _handleCreateNote(folderId, initialContent);
    // New note will be saved by useNotes via storage.saveNote; FS sync on next update
  };

  const closeTabById = useCallback((id: string) => {
    setOpenTabIds(prev => {
      const next = prev.filter(t => t !== id);
      if (id === activeNoteId) {
        const idx = prev.indexOf(id);
        setActiveNoteId(next[Math.min(idx, next.length - 1)] ?? '');
      }
      return next;
    });
  }, [activeNoteId, setActiveNoteId]);

  const handleDeleteNote = (id: string) => {
    closeTabById(id);
    syncNoteOnDelete(id);
    _handleDeleteNote(id);
  };

  const {
    isMobile,
    isSidebarOpen,
    setIsSidebarOpen,
    isRightPanelOpen,
    setIsRightPanelOpen,
    activeRightTab,
    setActiveRightTab,
    openGraphView,
    sidebarWidth,
    rightPanelWidth,
    isDraggingSidebar,
    isDraggingRightPanel,
    setIsDraggingSidebar,
    setIsDraggingRightPanel,
    editorViewMode,
    setEditorViewMode,
  } = useLayout();

  // Restore openTabIds from localStorage after notes load
  useEffect(() => {
    if (!isLoaded || notes.length === 0 || restoredOpenTabsRef.current) return;
    const saved = localStorage.getItem(OPEN_TABS_KEY);
    restoredOpenTabsRef.current = true;
    if (!saved) return;
    try {
      const ids: string[] = JSON.parse(saved);
      const validIds = ids.filter(id => notes.some(n => n.id === id));
      if (validIds.length > 0) setOpenTabIds(validIds);
    } catch { /* ignore */ }
  }, [isLoaded, notes]);

  // Persist openTabIds to localStorage
  useEffect(() => {
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openTabIds));
  }, [openTabIds]);

  // Sync activeNoteId into openTabIds
  useEffect(() => {
    if (!activeNoteId) return;
    setOpenTabIds(prev => prev.includes(activeNoteId) ? prev : [...prev, activeNoteId]);
  }, [activeNoteId]);

  const handleTabChange = useCallback((id: string) => {
    setActiveNoteId(id);
  }, [setActiveNoteId]);

  const handleTabClose = useCallback((id: string) => {
    closeTabById(id);
  }, [closeTabById]);

  const handleNewTab = useCallback(() => {
    handleCreateNote(folders[0]?.id ?? 'diary');
  }, [folders, handleCreateNote]);

  const openTabs = useMemo(
    () => openTabIds.map(id => notes.find(n => n.id === id)).filter(Boolean).map(n => ({ id: n!.id, title: n!.title })),
    [openTabIds, notes]
  );

  const globalTasks = useMemo(() => parseTasksFromNotes(notes), [notes]);
  const activeNote = activeNoteId ? notes.find(n => n.id === activeNoteId) : undefined;

  const {
    showReminder,
    daysSinceExport,
    lastExportAt,
    backupHealth,
    dismiss: dismissReminder,
  } = useBackupReminder(notes.length);

  const exportJsonQuick = useCallback(() => {
    exportJsonSnapshot(notes, folders, workspaceName);
  }, [notes, folders, workspaceName]);

  const commandPalette = useCommandPalette({
    notes,
    onCreateNote: () => handleCreateNote(folders[0]?.id ?? 'diary'),
    onOpenDailyNote: () => handleOpenDailyNote(),
    onOpenSettings: () => setIsSettingsOpen(true),
    onOpenGraphView: () => openGraphView(),
    onFocusSearch: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    onOpenNoteById: (id) => setActiveNoteId(id),
  });

  // BUG-B: flush pending saves before Electron quits — register once, use ref for latest notes
  const notesForQuitRef = useRef(notes);
  useEffect(() => { notesForQuitRef.current = notes; }, [notes]);
  useEffect(() => {
    const desktop = window.noaDesktop;
    if (!desktop?.lifecycle?.onBeforeQuit) return;
    return desktop.lifecycle.onBeforeQuit(() => {
      void flushAllPendingSaves(notesForQuitRef.current);
    });
  }, [flushAllPendingSaves]);

  useGlobalShortcuts({
    searchQuery,
    searchInputRef,
    onCreateNote: () => handleCreateNote(folders[0]?.id ?? 'diary'),
    onOpenDailyNote: () => handleOpenDailyNote(),
    onOpenCommandPalette: () => commandPalette.setIsOpen(true),
    onFocusSearch: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    onClearSearch: () => setSearchQuery(''),
    onForceSave: () => void flushAllPendingSaves(notesForQuitRef.current),
  });

  if (!isLoaded) {
    return (
      <div className="h-screen w-screen flex flex-col bg-[#EAE8E0] overflow-hidden">
        <div className="h-10 border-b border-[#2D2D2D]/20 bg-[#DCD9CE] shrink-0" />
        <div className="flex flex-1 overflow-hidden">
          <div className="w-[280px] border-r border-[#2D2D2D]/20 shrink-0" />
          <div className="flex-1" />
          <div className="w-[320px] border-l border-[#2D2D2D]/20 shrink-0" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#EAE8E0] text-[#2D2D2D] font-redaction overflow-hidden selection:bg-[#B89B5E] selection:text-white">
      <ThemeInjector settings={settings} />
      {showReminder && (
        <BackupReminderBar
          daysSinceExport={daysSinceExport}
          lastExportAt={lastExportAt}
          backupHealth={backupHealth}
          onExportJson={exportJsonQuick}
          onDismiss={dismissReminder}
        />
      )}
      <TopBar
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
        isSidebarOpen={isSidebarOpen}
        isRightPanelOpen={isRightPanelOpen}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onToggleGraphView={openGraphView}
        isGraphViewOpen={isRightPanelOpen && activeRightTab === 'graph'}
        showGraphView={settings.corePlugins.graphView}
        showDailyNote={settings.corePlugins.dailyNotes}
        searchInputRef={searchInputRef}
        onOpenDailyNote={() => handleOpenDailyNote()}
        workspaceName={workspaceName}
      />
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
            width: isMobile ? (isSidebarOpen ? '80%' : '0') : (isSidebarOpen ? sidebarWidth : '0'),
            maxWidth: isMobile ? '320px' : undefined,
            transition: isDraggingSidebar ? 'none' : 'width 200ms ease-in-out',
            minWidth: 0,
          }}
        >
          <div style={{ width: isMobile ? '80vw' : sidebarWidth, maxWidth: isMobile ? '320px' : undefined, transition: isDraggingSidebar ? 'none' : 'width 200ms ease-in-out' }} className="flex h-full shrink-0">
            <div className="flex-1 overflow-hidden">
              <Sidebar
                notes={notes}
                folders={folders}
                searchQuery={searchQuery}
                activeNoteId={activeNoteId}
                recentNoteIds={recentNoteIds}
                onSelectNote={(id) => {
                  setActiveNoteId(id);
                  if (isMobile) setIsSidebarOpen(false);
                }}
                onCreateNote={handleCreateNote}
                onDeleteNote={handleDeleteNote}
                onRenameNote={handleRenameNote}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onUpdateNoteContent={handleUpdateNote}
                onOpenDailyNote={handleOpenDailyNote}
                onImportNote={handleImportNote}
                onSearchTag={(tag) => setSearchQuery(`#${tag}`)}
                caseSensitive={settings.search.caseSensitive}
                fuzzySearch={settings.search.fuzzySearch}
                dateFormat={settings.dailyNotes.dateFormat}
              />
            </div>
            {!isMobile && (
              <div
                className="w-1.5 bg-transparent cursor-col-resize absolute right-0 top-0 bottom-0 z-50"
                onMouseDown={() => setIsDraggingSidebar(true)}
              />
            )}
          </div>
        </div>

        <ErrorBoundary>
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-[#2D2D2D]/60 text-sm">Loading editor…</div>}>
            <Editor
              note={activeNote}
              allNotes={notes}
              onUpdate={(content) => activeNote && handleUpdateNote(activeNote.id, content)}
              onRename={(title) => activeNote && handleRenameNote(activeNote.id, title)}
              onClose={() => handleTabClose(activeNoteId)}
              onNavigateToNote={handleNavigateToNote}
              viewMode={editorViewMode}
              setViewMode={setEditorViewMode}
              settings={settings}
              tabs={openTabs}
              onTabChange={handleTabChange}
              onTabClose={handleTabClose}
              onNewTab={handleNewTab}
            />
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
          className={`flex shrink-0 relative overflow-hidden ${isMobile ? 'absolute inset-y-0 right-0 z-40 bg-[#EAE8E0] shadow-xl' : ''}`}
          style={{
            width: isMobile ? (isRightPanelOpen ? '80%' : '0') : (isRightPanelOpen ? rightPanelWidth : '0'),
            maxWidth: isMobile ? '320px' : undefined,
            transition: isDraggingRightPanel ? 'none' : 'width 200ms ease-in-out',
            minWidth: 0,
          }}
        >
          <div style={{ width: isMobile ? '80vw' : rightPanelWidth, maxWidth: isMobile ? '320px' : undefined, transition: isDraggingRightPanel ? 'none' : 'width 200ms ease-in-out' }} className="flex h-full shrink-0">
            {!isMobile && (
              <div
                className="w-1.5 bg-transparent cursor-col-resize absolute left-0 top-0 bottom-0 z-50"
                onMouseDown={() => setIsDraggingRightPanel(true)}
              />
            )}
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary>
              <Suspense fallback={<div className="h-full flex items-center justify-center text-[#2D2D2D]/60 text-sm">Loading panel…</div>}>
                <RightPanel
                  tasks={globalTasks}
                  onToggleTask={handleToggleTask}
                  onNavigateToNote={(title) => {
                    handleNavigateToNote(title);
                    if (isMobile) setIsRightPanelOpen(false);
                  }}
                  activeNote={activeNote}
                  activeTab={activeRightTab}
                  onTabChange={setActiveRightTab}
                  notes={notes}
                  settings={settings}
                  activeNoteTitle={activeNote?.title}
                />
              </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </div>
      {saveError && (
        <div className="fixed bottom-4 right-4 z-50 border border-amber-400 bg-amber-50 px-4 py-3 max-w-sm shadow-lg">
          <div className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-1">Warning · Save</div>
          <div className="text-[11px] text-amber-700 leading-relaxed mb-3">{saveError}</div>
          <button
            onClick={clearSaveError}
            className="text-[10px] uppercase tracking-wider font-bold border border-amber-500 px-2 py-0.5 text-amber-700 hover:bg-amber-100 transition-colors active:opacity-70"
          >
            Dismiss
          </button>
        </div>
      )}
      {fsSyncError && fsHandle && (
        <div className="fixed bottom-4 left-4 z-50 border border-red-400 bg-red-50 px-4 py-3 max-w-sm shadow-lg">
          <div className="text-xs font-bold text-red-800 uppercase tracking-wider mb-1">Error · File Sync</div>
          <div className="text-[11px] text-red-700 leading-relaxed mb-3">{fsSyncError}</div>
          <button
            onClick={retry}
            className="text-[10px] uppercase tracking-wider font-bold border border-red-500 px-2 py-0.5 text-red-700 hover:bg-red-100 transition-colors"
          >
            Retry Sync
          </button>
        </div>
      )}
      {showStorageNotice && (
        <div className="fixed bottom-20 right-4 z-50 border border-[#2D2D2D]/20 bg-[#DCD9CE] px-4 py-3 max-w-xs font-redaction shadow-lg">
          <div className="text-xs font-bold text-[#2D2D2D] uppercase tracking-wider mb-1">Local Storage Only</div>
          <div className="text-[11px] text-[#2D2D2D]/60 leading-relaxed mb-3">
            {LOCAL_DATA_BOUNDARY_COPY}
          </div>
          <button
            onClick={() => {
              setShowStorageNotice(false);
              localStorage.setItem('redaction-storage-notice-seen', '1');
            }}
            className="text-[10px] uppercase tracking-wider font-bold border border-[#2D2D2D]/30 px-2 py-0.5 text-[#2D2D2D]/60 hover:text-[#2D2D2D] hover:border-[#2D2D2D]/60 transition-colors"
          >
            Got it
          </button>
        </div>
      )}
      {loadError && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl bg-[#EAE8E0] border-2 border-[#2D2D2D] shadow-[4px_4px_0px_0px_rgba(45,45,45,0.25)] p-4 font-redaction space-y-3">
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
                className="px-3 py-1 text-xs font-bold bg-[#B89B5E] text-white border-2 border-[#2D2D2D] hover:opacity-90"
              >
                Import Backup
              </button>
              <button
                onClick={() => {
                  void resetWorkspaceFromRecovery();
                }}
                className="px-3 py-1 text-xs font-bold bg-red-100 text-red-800 border-2 border-red-400 hover:bg-red-200"
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
            className="w-full max-w-xl border-2 border-[#2D2D2D] bg-[#EAE8E0] shadow-[4px_4px_0px_0px_rgba(45,45,45,0.25)]"
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
                className="w-full bg-[#EAE8E0] border border-[#2D2D2D] px-3 py-2 text-sm font-redaction outline-none focus:border-[#B89B5E]"
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
            onDisconnectFs={disconnect}
            fsLastSyncAt={fsLastSyncAt}
            fsSyncError={fsSyncError}
            syncStatus={syncStatus}
            onRetryFsSync={retry}
          />
        </Suspense>
      )}
    </div>
  );
}
