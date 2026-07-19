import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { useSidebarDrag } from '../hooks/useSidebarDrag';
import { useSidebarSearch } from '../hooks/useSidebarSearch';
import { classifyFolderImportFile } from '../lib/importUtils';
import { getFolderLeafName, getFolderParentPath } from '../lib/pathUtils';
import { lsGet, lsSet } from '../lib/safeLocalStorage';
import { builtinTemplates, applyTemplate } from '../lib/templates';
import { Note, Folder as FolderType } from '../types';
import CalendarPanel from './CalendarPanel';
import { FileNode, buildFolderTree, FolderTreeNode } from './sidebar/FileNode';
import { TagBrowser } from './sidebar/TagBrowser';
import { FileText, Plus, Folder, FolderPlus, Calendar, SquarePen, ChevronsDownUp, ChevronsUpDown, ArrowUpDown, Dices, X } from '@/src/lib/icons';

// Renders a search-highlight snippet safely without dangerouslySetInnerHTML.
// The search engine wraps matched characters in <b>…</b>; we parse those tags
// out and reconstruct the content as React nodes — no raw HTML ever reaches the DOM.
function HighlightedText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const parts = text.split(/(<b>|<\/b>)/);
  const nodes: React.ReactNode[] = [];
  let inBold = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '<b>') { inBold = true; continue; }
    if (part === '</b>') { inBold = false; continue; }
    if (part === '') continue;
    nodes.push(inBold ? <b key={i}>{part}</b> : <React.Fragment key={i}>{part}</React.Fragment>);
  }
  return <>{nodes}</>;
}

function isInlinePreviewableAttachment(file: File): boolean {
  return file.type.startsWith('image/')
    || /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico|tif|tiff)$/i.test(file.name);
}

const NOA_ROOT_DROP_TARGET_ID = '__root_noa__';
const IMPORT_ROOT_DROP_TARGET_ID = '__root_import__';

interface SidebarNoteRowProps {
  note: Note;
  depth: number;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onRequestDelete: (id: string, name: string) => void;
  onRename: (id: string, newName: string) => void;
  onDragStart: (kind: 'note' | 'folder', id: string, name: string) => (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

// Memo boundary for note rows: the sidebar re-renders on every notes-state
// change (every keystroke — modified-time sorting depends on it), but rows for
// untouched notes keep the same props and skip. All callbacks must stay
// referentially stable or this memo is defeated.
const SidebarNoteRow = React.memo(function SidebarNoteRow({
  note, depth, isActive, isSelected,
  onSelect, onRequestDelete, onRename, onDragStart, onDragEnd,
}: SidebarNoteRowProps) {
  const displayName = note.title || 'Untitled';
  return (
    <FileNode
      name={displayName + '.md'}
      isActive={isActive}
      isSelected={isSelected}
      onClick={(e) => onSelect(note.id, e.metaKey || e.ctrlKey)}
      onDelete={() => onRequestDelete(note.id, displayName)}
      onRename={(newName: string) => onRename(note.id, newName)}
      iconColor="#CC7D5E"
      draggable
      onDragStart={onDragStart('note', note.id, displayName)}
      onDragEnd={onDragEnd}
      depth={depth}
    />
  );
});

interface SidebarProps {
  notes: Note[];
  folders: FolderType[];
  searchQuery: string;
  activeNoteId: string;
  onSelectNote: (id: string) => void;
  onCreateNote: (folderId: string, initialContent?: string) => void;
  onDeleteNote: (id: string) => void;
  onRenameNote: (id: string, newName: string) => void;
  onMoveNote: (id: string, folderId: string) => void;
  onCreateFolder: (parentFolderId?: string) => void;
  onRenameFolder: (id: string, newName: string) => void;
  onDeleteFolder: (id: string) => void;
  onOpenDailyNote?: (targetDate?: string) => void;
  onImportNote?: (title: string, content: string, folderId?: string, attachmentFile?: File | null) => void;
  onSearchTag?: (tag: string) => void;
  onClearSearch?: () => void;
  caseSensitive?: boolean;
  fuzzySearch?: boolean;
  dateFormat?: string;
}

export default function Sidebar({
  notes, folders, searchQuery, activeNoteId,
  onSelectNote, onCreateNote, onDeleteNote, onRenameNote,
  onMoveNote, onCreateFolder, onRenameFolder, onDeleteFolder,
  onOpenDailyNote,
  onImportNote, onSearchTag, onClearSearch, caseSensitive = false, fuzzySearch = true, dateFormat = 'YYYY-MM-DD',
}: SidebarProps) {

  const [pendingDelete, setPendingDelete] = useState<{ type: 'note' | 'folder'; id: string; name: string } | null>(null);
  const [foldersExpandedByDefault, setFoldersExpandedByDefault] = useState(false);
  const [folderTreeResetKey, setFolderTreeResetKey] = useState(0);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [templateMenuFolderId, setTemplateMenuFolderId] = useState<string | null>(null);
  const isVaultFolder = useCallback((folder: FolderType) => folder.origin === 'vault', []);

  const searchResults = useSidebarSearch({ notes, folders, searchQuery, caseSensitive, fuzzySearch });

  const {
    dropTargetId,
    handleDropItem,
    handleDragStartItem,
    handleDragEndItem,
    handleDragOverTarget,
    handleDragEnterTarget,
  } = useSidebarDrag({ notes, folders, onMoveNote, onRenameFolder });
  const noaFolders = useMemo(() => folders.filter((folder) => !isVaultFolder(folder)), [folders, isVaultFolder]);
  const vaultFolders = useMemo(() => folders.filter(isVaultFolder), [folders, isVaultFolder]);
  const noaFolderTree = useMemo(() => buildFolderTree(noaFolders), [noaFolders]);
  const vaultFolderTree = useMemo(() => buildFolderTree(vaultFolders), [vaultFolders]);

  type NoteSortOrder = 'updatedAt' | 'createdAt' | 'name';
  const [noteSortOrder, setNoteSortOrder] = useState<NoteSortOrder>(() =>
    (lsGet(STORAGE_KEYS.NOTE_SORT_ORDER) as NoteSortOrder) || 'updatedAt'
  );
  useEffect(() => { lsSet(STORAGE_KEYS.NOTE_SORT_ORDER, noteSortOrder); }, [noteSortOrder]);

  // Sorted once per notes/sort-order change — sorting inside the render pass
  // (per folder, per render) re-copied and re-sorted every list on every
  // keystroke.
  const notesByFolderId = useMemo(() => {
    const map = new Map<string, Note[]>();
    notes.forEach((note) => {
      const key = note.folder || '';
      const list = map.get(key) || [];
      list.push(note);
      map.set(key, list);
    });
    const compare: (a: Note, b: Note) => number =
      noteSortOrder === 'name' ? (a, b) => (a.title || '').localeCompare(b.title || '')
      : noteSortOrder === 'createdAt' ? (a, b) => b.createdAt.localeCompare(a.createdAt)
      : (a, b) => b.updatedAt.localeCompare(a.updatedAt);
    map.forEach((list) => list.sort(compare));
    return map;
  }, [notes, noteSortOrder]);
  const rootNoaNotes = useMemo(
    () => (notesByFolderId.get('') || []).filter((note) => note.origin !== 'vault'),
    [notesByFolderId]
  );
  const rootVaultNotes = useMemo(
    () => (notesByFolderId.get('') || []).filter((note) => note.origin === 'vault'),
    [notesByFolderId]
  );

  // Stable handlers for SidebarNoteRow — see the memo note on that component.
  const handleNoteRowSelect = useCallback((id: string, multi: boolean) => {
    if (multi) {
      setSelectedNoteIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedNoteIds(new Set());
      onSelectNote(id);
    }
  }, [onSelectNote]);
  const handleNoteRowDelete = useCallback((id: string, name: string) => {
    setPendingDelete({ type: 'note', id, name });
  }, []);
  const primaryNoaFolderId = useMemo(
    () => (folders.find((folder) => !isVaultFolder(folder))?.id ?? ''),
    [folders, isVaultFolder]
  );

  const renameFolderWithValidation = useCallback((id: string, nextPath: string): string | void => {
    const targetFolder = folders.find((folder) => folder.id === id);
    if (!targetFolder) return 'Folder not found.';
    const normalizedNextPath = nextPath.trim() || 'Untitled Folder';
    const nextParentPath = getFolderParentPath(normalizedNextPath);
    const nextLeafName = getFolderLeafName(normalizedNextPath).toLocaleLowerCase();
    const targetIsVault = isVaultFolder(targetFolder);
    const conflict = folders.some((folder) => {
      if (folder.id === id) return false;
      if (isVaultFolder(folder) !== targetIsVault) return false;
      if (getFolderParentPath(folder.name) !== nextParentPath) return false;
      return getFolderLeafName(folder.name).toLocaleLowerCase() === nextLeafName;
    });
    if (conflict) return 'A folder with this name already exists in this location.';
    onRenameFolder(id, normalizedNextPath);
  }, [folders, isVaultFolder, onRenameFolder]);

  const getFolderSubtreeNoteCount = useCallback((folderId: string) => {
    const target = folders.find((folder) => folder.id === folderId);
    if (!target) return 0;
    const targetIsVault = isVaultFolder(target);
    const targetIds = new Set(
      folders
        .filter((folder) =>
          isVaultFolder(folder) === targetIsVault
          && (folder.name === target.name || folder.name.startsWith(`${target.name}/`)))
        .map((folder) => folder.id)
    );
    return notes.filter((note) => targetIds.has(note.folder)).length;
  }, [folders, isVaultFolder, notes]);

  const renderFolderNode = useCallback((node: FolderTreeNode, depth: number, activeId: string, parentPath: string = '') => {
    const leafName = getFolderLeafName(node.folder.name);
    const canCreateInsideFolder = !isVaultFolder(node.folder);
    const childNotes = notesByFolderId.get(node.folder.id) || [];
    const hasChildren = node.children.length > 0 || childNotes.length > 0;
    const nextPath = parentPath ? `${parentPath}/${leafName}` : leafName;
    return (
      <div key={`${node.folder.id}-${folderTreeResetKey}`} className="relative">
        {templateMenuFolderId === node.folder.id && (
          <div
            data-template-menu
            className="absolute right-0 top-7 z-50 bg-[#F9F9F7] border-2 border-[#2D2D2B] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] min-w-[160px]"
          >
            {builtinTemplates.map(t => (
              <button
                key={t.id}
                className="w-full text-left px-3 py-1.5 text-sm font-redaction hover:bg-[#EFEAE3] text-[#2D2D2B]"
                onClick={() => {
                  onCreateNote(node.folder.id, applyTemplate(t, 'New Note'));
                  setTemplateMenuFolderId(null);
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
        <FileNode
          name={leafName}
          isFolder
          defaultOpen={foldersExpandedByDefault}
          icon={Folder}
          onAdd={canCreateInsideFolder ? () => setTemplateMenuFolderId(templateMenuFolderId === node.folder.id ? null : node.folder.id) : undefined}
          onAddFolder={canCreateInsideFolder ? () => onCreateFolder(node.folder.id) : undefined}
          draggable
          onDragStart={handleDragStartItem('folder', node.folder.id, node.folder.name)}
          onDragEnter={handleDragEnterTarget(node.folder.id)}
          onDragOver={handleDragOverTarget(node.folder.id)}
          onDrop={(e) => handleDropItem(node.folder.id, e)}
          onDragEnd={handleDragEndItem}
          isDropTarget={dropTargetId === node.folder.id}
          addButtonProps={{ 'data-template-btn': node.folder.id }}
          onRename={(newName: string) => renameFolderWithValidation(node.folder.id, parentPath ? `${parentPath}/${newName}` : newName)}
          onDelete={() => setPendingDelete({ type: 'folder', id: node.folder.id, name: node.folder.name })}
          depth={depth}
        >
          {node.children.map((child) => renderFolderNode(child, depth + 1, activeId, nextPath))}
          {childNotes.map((note) => (
            <SidebarNoteRow
              key={note.id}
              note={note}
              depth={depth + 1}
              isActive={activeId === note.id}
              isSelected={selectedNoteIds.has(note.id)}
              onSelect={handleNoteRowSelect}
              onRequestDelete={handleNoteRowDelete}
              onRename={onRenameNote}
              onDragStart={handleDragStartItem}
              onDragEnd={handleDragEndItem}
            />
          ))}
          {/* 22px aligns with FileNode's icon column: 2 (child padding) + 16 (chevron) + 4 (gap). */}
          {!hasChildren && <div className="text-[#2D2D2B]/50 py-1 font-redaction" style={{ paddingLeft: '22px' }}>Empty</div>}
        </FileNode>
      </div>
    );
  }, [dropTargetId, folderTreeResetKey, foldersExpandedByDefault, handleDragEndItem, handleDragEnterTarget, handleDragOverTarget, handleDragStartItem, handleDropItem, handleNoteRowDelete, handleNoteRowSelect, isVaultFolder, notesByFolderId, onCreateFolder, onCreateNote, onRenameNote, renameFolderWithValidation, selectedNoteIds, templateMenuFolderId]);

  useEffect(() => {
    if (!templateMenuFolderId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('[data-template-menu]') && !target.closest('[data-template-btn]')) {
        setTemplateMenuFolderId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [templateMenuFolderId]);

  const [isDragOver, setIsDragOver] = useState(false);

  // During dragenter/dragover/dragleave, browsers put dataTransfer in "protected mode"
  // where files is an empty FileList — only `types` reliably exposes that files are involved.
  // (files becomes populated only at drop time.)
  const isFileImportDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (isFileImportDrag(e)) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isFileImportDrag(e)) return;
    // dragleave fires every time the cursor crosses an internal child boundary.
    // Only clear the overlay when the cursor actually exits the sidebar
    // (relatedTarget is null when leaving the window entirely; contains(null) is false).
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (isFileImportDrag(e)) {
      setIsDragOver(false);
    }

    if (!onImportNote) return;

    const files = Array.from(e.dataTransfer.files);

    let failCount = 0;
    for (const file of files) {
      try {
        const folderId = primaryNoaFolderId || 'diary';
        const importKind = classifyFolderImportFile(file);
        const title = file.name.replace(/\.[^/.]+$/, '');

        if (importKind.kind === 'text') {
          const text = await file.text();
          onImportNote(title, text, folderId);
          continue;
        }

        if (importKind.kind === 'attachment') {
          const inlinePreview = isInlinePreviewableAttachment(file);
          onImportNote(title, inlinePreview ? `![[${file.name}]]` : `Attached file: ${file.name}`, folderId, file);
          continue;
        }

        failCount++;
      } catch {
        failCount++;
      }
    }
    if (failCount > 0) {
      console.warn(`[Noa] ${failCount} file(s) failed to import via drag-and-drop`);
    }
  };

  return (
    <div 
      className="w-full h-full flex flex-col bg-[#F9F9F7] shrink-0 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 bg-[#CC7D5E]/10 border-2 border-dashed border-[#CC7D5E] z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-[#F9F9F7] px-4 py-2 border border-[#CC7D5E] shadow-lg font-redaction font-bold text-[#CC7D5E] flex items-center">
            <Plus size={16} className="mr-2" />
            Drop files to import
          </div>
        </div>
      )}
      <div className="h-8 border-b flex items-center px-2 gap-0.5 shrink-0 bg-[#EFEAE3] z-10 overflow-hidden" style={{ borderBottomColor: 'var(--panel-divider, #2D2D2B)' }}>
        <button
          onClick={() => onCreateNote(primaryNoaFolderId)}
          className="p-1 text-[#2D2D2B]/70 hover:text-[#CC7D5E] transition-colors active:opacity-70"
          title="New note"
        >
          <SquarePen size={14} />
        </button>
        <button
          onClick={() => onCreateFolder()}
          className="p-1 text-[#2D2D2B]/70 hover:text-[#CC7D5E] transition-colors active:opacity-70"
          title="New folder"
        >
          <FolderPlus size={14} />
        </button>
        <button
          onClick={() => {
            setFoldersExpandedByDefault((value) => !value);
            setFolderTreeResetKey((value) => value + 1);
          }}
          className="p-1 text-[#2D2D2B]/70 hover:text-[#CC7D5E] transition-colors active:opacity-70"
          title={foldersExpandedByDefault ? 'Collapse all folders' : 'Expand all folders'}
        >
          {foldersExpandedByDefault ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
        </button>
        <button
          onClick={() => onOpenDailyNote?.()}
          className="p-1 text-[#2D2D2B]/70 hover:text-[#CC7D5E] transition-colors active:opacity-70"
          title="Open today's daily note"
        >
          <Calendar size={14} />
        </button>
        <button
          onClick={() => {
            if (notes.length === 0) return;
            const randomNote = notes[Math.floor(Math.random() * notes.length)];
            onSelectNote(randomNote.id);
          }}
          className="p-1 text-[#2D2D2B]/70 hover:text-[#CC7D5E] transition-colors active:opacity-70"
          title="Open random note"
        >
          <Dices size={14} />
        </button>
        <button
          onClick={() => setNoteSortOrder(o => o === 'updatedAt' ? 'createdAt' : o === 'createdAt' ? 'name' : 'updatedAt')}
          className="flex items-center gap-1 px-1 py-1 transition-colors active:opacity-70 ml-auto text-[#2D2D2B]/50 hover:text-[#CC7D5E]"
          style={{ color: noteSortOrder !== 'updatedAt' ? '#CC7D5E' : undefined }}
          title="Click to cycle sort order"
        >
          <ArrowUpDown size={14} />
          <span className="text-[10px] uppercase tracking-wide leading-none">
            {noteSortOrder === 'updatedAt' ? 'Modified' : noteSortOrder === 'createdAt' ? 'Created' : 'Name'}
          </span>
        </button>
      </div>

      {pendingDelete && (
        <div className="slide-down border-b border-[#2D2D2B]/20 bg-[#CC7D5E]/10 px-3 py-2 flex flex-col gap-1.5 font-redaction shrink-0 z-10">
          <p className="text-xs text-[#2D2D2B]">
            Delete "<span className="font-bold">{pendingDelete.name}</span>"?{' '}
            {pendingDelete.type === 'folder'
              ? (() => {
                  const target = folders.find((folder) => folder.id === pendingDelete.id);
                  const count = target ? getFolderSubtreeNoteCount(target.id) : notes.filter(n => n.folder === pendingDelete.id).length;
                  if (count > 0) {
                    const targetIsVault = target ? isVaultFolder(target) : false;
                    const subtreeIds = new Set(
                      folders
                        .filter((f) =>
                          f.id === target?.id
                          || (isVaultFolder(f) === targetIsVault && f.name.startsWith((target?.name ?? '') + '/')))
                        .map((f) => f.id)
                    );
                    const affectedNotes = notes.filter((n) => subtreeIds.has(n.folder));
                    const preview = affectedNotes.slice(0, 5);
                    return (
                      <>
                        <span>{`This folder and its subfolders contain ${count} note${count !== 1 ? 's' : ''}. All notes will be permanently deleted.`}</span>
                        <ul className="mt-1 list-disc list-inside">
                          {preview.map((n) => (
                            <li key={n.id} className="truncate">{n.title}</li>
                          ))}
                          {affectedNotes.length > 5 && <li>…and {affectedNotes.length - 5} more</li>}
                        </ul>
                      </>
                    );
                  }
                  return 'This cannot be undone.';
                })()
              : 'This cannot be undone.'}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                if (pendingDelete.type === 'note') onDeleteNote(pendingDelete.id);
                else onDeleteFolder(pendingDelete.id);
                setPendingDelete(null);
              }}
              className="px-2 py-0.5 text-xs font-bold bg-[#D45555] text-white border border-[#2D2D2B] hover:opacity-90 active:opacity-70"
            >
              Delete
            </button>
            <button
              onClick={() => setPendingDelete(null)}
              className="px-2 py-0.5 text-xs font-bold bg-[#F9F9F7] border border-[#2D2D2B] hover:bg-[#EFEAE3]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bulk selection action bar */}
      {selectedNoteIds.size > 0 && (
        <div className="border-b border-[#2D2D2B]/20 bg-[#CC7D5E]/10 px-3 py-1.5 flex items-center justify-between shrink-0 font-redaction">
          <span className="text-xs text-[#2D2D2B]/70">{selectedNoteIds.size} selected</span>
          <div className="flex items-center gap-1.5">
            {!pendingBulkDelete ? (
              <>
                <button
                  onClick={() => setPendingBulkDelete(true)}
                  className="px-2 py-0.5 text-xs font-bold bg-[#D45555] text-white border border-[#2D2D2B] hover:opacity-90 active:opacity-70"
                >
                  Delete
                </button>
                <button
                  onClick={() => setSelectedNoteIds(new Set())}
                  className="px-2 py-0.5 text-xs font-bold bg-[#F9F9F7] border border-[#2D2D2B] hover:bg-[#EFEAE3] active:opacity-70"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-[#C24444]">Delete {selectedNoteIds.size} note{selectedNoteIds.size !== 1 ? 's' : ''}?</span>
                <button
                  onClick={() => {
                    selectedNoteIds.forEach(id => onDeleteNote(id));
                    setSelectedNoteIds(new Set());
                    setPendingBulkDelete(false);
                  }}
                  className="px-2 py-0.5 text-xs font-bold bg-[#D45555] text-white border border-[#2D2D2B] hover:opacity-90 active:opacity-70"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setPendingBulkDelete(false)}
                  className="px-2 py-0.5 text-xs font-bold bg-[#F9F9F7] border border-[#2D2D2B] hover:bg-[#EFEAE3] active:opacity-70"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main Content Section */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
        <div className="pt-1 pb-2">
          {searchQuery ? (
              <div className="-mr-[5px]">
                <div className="text-xs text-[#2D2D2B]/50 mb-2 px-2 font-redaction uppercase tracking-wider flex items-center justify-between">
                  <span>Search Results ({searchResults.length})</span>
                  {onClearSearch && (
                    <button
                      onClick={onClearSearch}
                      className="text-[#2D2D2B]/40 hover:text-[#CC7D5E] hover:bg-[#EFEAE3] active:opacity-70 shrink-0 -mr-1 p-1 rounded"
                      title="Close search"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                {searchResults.map(result => (
                  <div 
                    key={result.note.id}
                    className={`p-2 cursor-pointer border-l-2 ${activeNoteId === result.note.id ? 'bg-[#CC7D5E]/10 border-l-[#CC7D5E]' : 'border-l-transparent hover:bg-[#EFEAE3]/50'} transition-colors`}
                    onClick={() => onSelectNote(result.note.id)}
                  >
                    <div className="font-bold font-redaction text-sm text-[#2D2D2B] mb-1 flex items-center">
                      <FileText size={12} className="mr-1.5 text-[#CC7D5E] shrink-0" />
                      <span className="truncate">
                        {result.titleSnippet ? <HighlightedText text={result.titleSnippet} /> : 'Untitled'}
                      </span>
                    </div>
                    <div className="text-xs text-[#2D2D2B]/70 font-redaction leading-relaxed break-words line-clamp-2">
                      <HighlightedText text={result.contentSnippet} />
                    </div>
                    {result.note.tags && result.note.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {result.note.tags.map(tag => (
                          <span key={tag} className="text-[10px] font-redaction text-[#CC7D5E] bg-[#CC7D5E]/10 px-1">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {searchResults.length === 0 && (
                  <div className="text-[#2D2D2B]/50 px-2 py-4 font-redaction text-sm text-center">
                    No matches found
                  </div>
                )}
              </div>
            ) : (
              <>
              <div data-testid="sidebar-file-tree" className="pt-1">
                {/* Noa-native notes — flat root, no wrapper node */}
                <div
                  onDragEnter={handleDragEnterTarget(NOA_ROOT_DROP_TARGET_ID)}
                  onDragOver={handleDragOverTarget(NOA_ROOT_DROP_TARGET_ID)}
                  onDrop={(e) => handleDropItem(null, e)}
                  onDragLeave={() => handleDragEndItem()}
                  className={dropTargetId === NOA_ROOT_DROP_TARGET_ID ? 'ring-1 ring-inset ring-[#CC7D5E]/50' : ''}
                >
                  {noaFolderTree.map((node) => renderFolderNode(node, 0, activeNoteId))}
                  {rootNoaNotes.map((note) => (
                    <SidebarNoteRow
                      key={note.id}
                      note={note}
                      depth={0}
                      isActive={activeNoteId === note.id}
                      isSelected={selectedNoteIds.has(note.id)}
                      onSelect={handleNoteRowSelect}
                      onRequestDelete={handleNoteRowDelete}
                      onRename={onRenameNote}
                      onDragStart={handleDragStartItem}
                      onDragEnd={handleDragEndItem}
                    />
                  ))}
                </div>

                {/* Connected vault section — ownership is origin, not import provenance. */}
                {(vaultFolderTree.length > 0 || rootVaultNotes.length > 0) && (
                  <>
                    <div className="flex items-center gap-2 px-2 py-1.5 -mr-[5px]">
                      <div className="flex-1 border-t border-[#2D2D2B]/20" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#2D2D2B]/40 font-redaction shrink-0">Obsidian Vault</span>
                      <div className="flex-1 border-t border-[#2D2D2B]/20" />
                    </div>
                    <div
                      onDragEnter={handleDragEnterTarget(IMPORT_ROOT_DROP_TARGET_ID)}
                      onDragOver={handleDragOverTarget(IMPORT_ROOT_DROP_TARGET_ID)}
                      onDrop={(e) => handleDropItem(null, e, true)}
                      onDragEnd={handleDragEndItem}
                    >
                      {vaultFolderTree.map((node) => renderFolderNode(node, 0, activeNoteId))}
                      {rootVaultNotes.map((note) => (
                        <SidebarNoteRow
                          key={note.id}
                          note={note}
                          depth={0}
                          isActive={activeNoteId === note.id}
                          isSelected={selectedNoteIds.has(note.id)}
                          onSelect={handleNoteRowSelect}
                          onRequestDelete={handleNoteRowDelete}
                          onRename={onRenameNote}
                          onDragStart={handleDragStartItem}
                          onDragEnd={handleDragEndItem}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
              </>
            )}
          </div>
        </div>

      {/* Calendar Panel — always mounted so open/closed and viewMonth state survive
          search toggles (otherwise it remounts on every searchQuery flip). */}
      <CalendarPanel
        notes={notes}
        activeNoteId={activeNoteId}
        onSelectDate={(dateStr) => onOpenDailyNote?.(dateStr)}
        dateFormat={dateFormat}
      />

      <TagBrowser notes={notes} onSearchTag={onSearchTag} searchQuery={searchQuery} />
    </div>
  );
}
