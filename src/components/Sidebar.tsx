import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSidebarDrag } from '../hooks/useSidebarDrag';
import { useSidebarSearch } from '../hooks/useSidebarSearch';
import { attachEdgeFade } from '../lib/edgeFade';
import { classifyFolderImportFile } from '../lib/importUtils';
import { getFolderLeafName, getFolderParentPath } from '../lib/pathUtils';
import { builtinTemplates, applyTemplate } from '../lib/templates';
import { VAULT_ROOT_FOLDER_ID } from '../lib/workspaceOwnership';
import { Note, Folder as FolderType } from '../types';
import { FileNode, buildFolderTree, FolderTreeNode } from './sidebar/FileNode';
import { VaultFooter, VaultFooterProps } from './sidebar/VaultFooter';
import { FileText, Plus, Folder, FolderPlus, BookOpen, Calendar, SquarePen, Users, ChevronsUpDown, ChevronsDownUp, Dices, X } from '@/src/lib/icons';

export type NoteSortOrder = 'updatedAt' | 'name';

// Per-template glyph for the folder "add note" menu, keyed by builtin template id.
// A new builtin added without an entry here falls back to the generic note icon.
const templateMenuIcons: Record<string, typeof FileText> = {
  blank: FileText,
  daily: Calendar,
  meeting: Users,
  reading: BookOpen,
};

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
  isDragging: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onRequestDelete: (id: string, name: string) => void;
  onRename: (id: string, newName: string) => void;
  onDuplicate: (id: string) => void;
  onDragStart: (kind: 'note' | 'folder', id: string, name: string) => (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

// Memo boundary for note rows: the sidebar re-renders every keystroke, so all callbacks must stay referentially stable.
const SidebarNoteRow = React.memo(function SidebarNoteRow({
  note, depth, isActive, isSelected, isDragging,
  onSelect, onRequestDelete, onRename, onDuplicate, onDragStart, onDragEnd,
}: SidebarNoteRowProps) {
  const displayName = note.title || 'Untitled';
  return (
    <FileNode
      name={displayName}
      isActive={isActive}
      isSelected={isSelected}
      isDragging={isDragging}
      onClick={(e) => onSelect(note.id, e.metaKey || e.ctrlKey)}
      onDelete={() => onRequestDelete(note.id, displayName)}
      onRename={(newName: string) => onRename(note.id, newName)}
      onDuplicate={note.origin === 'vault' ? undefined : () => onDuplicate(note.id)}
      onCopyLink={() => {
        // Same sanitising as rename's link rewrite: these characters would break [[...]] syntax.
        const target = displayName.replace(/\]\]/g, '] ]').replace(/[|#]/g, ' ');
        void navigator.clipboard?.writeText(`[[${target}]]`).catch(() => {});
      }}
      draggable
      onDragStart={onDragStart('note', note.id, displayName)}
      onDragEnd={onDragEnd}
      depth={depth}
    />
  );
});

interface SidebarProps {
  notes: Note[];
  /** Owned by App: the switch for it lives in the titlebar. */
  noteSortOrder: NoteSortOrder;
  folders: FolderType[];
  searchQuery: string;
  activeNoteId: string;
  onSelectNote: (id: string) => void;
  onCreateNote: (folderId: string, initialContent?: string) => void;
  onDeleteNote: (id: string) => void;
  onRenameNote: (id: string, newName: string) => void;
  onDuplicateNote: (id: string) => void;
  onMoveNote: (id: string, folderId: string) => void;
  onCreateFolder: (parentFolderId?: string) => void;
  onRenameFolder: (id: string, newName: string) => void;
  onDeleteFolder: (id: string) => void;
  onOpenDailyNote?: (targetDate?: string) => void;
  dailyNotesEnabled?: boolean;
  vault: VaultFooterProps;
  onImportNote?: (title: string, content: string, folderId?: string, attachmentFile?: File | null) => void;
  onClearSearch?: () => void;
  caseSensitive?: boolean;
  fuzzySearch?: boolean;
}

export default function Sidebar({
  notes, noteSortOrder, folders, searchQuery, activeNoteId,
  onSelectNote, onCreateNote, onDeleteNote, onRenameNote, onDuplicateNote,
  onMoveNote, onCreateFolder, onRenameFolder, onDeleteFolder,
  onOpenDailyNote, dailyNotesEnabled = true, vault,
  onImportNote, onClearSearch, caseSensitive = false, fuzzySearch = true,
}: SidebarProps) {

  const [pendingDelete, setPendingDelete] = useState<{ type: 'note' | 'folder'; id: string; name: string } | null>(null);
  const [foldersExpandedByDefault, setFoldersExpandedByDefault] = useState(false);
  const [folderTreeResetKey, setFolderTreeResetKey] = useState(0);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(null);
  const blankMenuRef = useRef<HTMLDivElement>(null);
  const [templateMenuFolderId, setTemplateMenuFolderId] = useState<string | null>(null);
  const isVaultFolder = useCallback((folder: FolderType) => folder.origin === 'vault', []);

  const searchResults = useSidebarSearch({ notes, folders, searchQuery, caseSensitive, fuzzySearch });

  const {
    draggingId,
    dropTargetId,
    handleDropItem,
    handleDragStartItem,
    handleDragEndItem,
    handleDragTarget,
  } = useSidebarDrag({ notes, folders, onMoveNote, onRenameFolder });
  const noaFolders = useMemo(() => folders.filter((folder) => !isVaultFolder(folder)), [folders, isVaultFolder]);
  const vaultFolders = useMemo(() => folders.filter(isVaultFolder), [folders, isVaultFolder]);
  const noaFolderTree = useMemo(() => buildFolderTree(noaFolders), [noaFolders]);
  const vaultFolderTree = useMemo(() => buildFolderTree(vaultFolders), [vaultFolders]);


  // Sorted once per notes/sort-order change, not per render.
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

  // Stable handlers for SidebarNoteRow (see the memo note above).
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
  // With a vault connected it is the whole workspace, so every create entry point targets its root.
  const blankCreateTarget = vault.vaultName || vaultFolders.length > 0 || notes.some((note) => note.origin === 'vault')
    ? VAULT_ROOT_FOLDER_ID
    : primaryNoaFolderId;

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

  // Both roots drop into the null folder and are told apart by ownership; the ids only mark which region lights up.
  const markNoaRootTarget = useMemo(
    () => handleDragTarget(NOA_ROOT_DROP_TARGET_ID, null),
    [handleDragTarget]
  );
  const markVaultRootTarget = useMemo(
    () => handleDragTarget(IMPORT_ROOT_DROP_TARGET_ID, null, true),
    [handleDragTarget]
  );

  const renderFolderNode = useCallback((node: FolderTreeNode, depth: number, activeId: string, parentPath: string = '') => {
    const leafName = getFolderLeafName(node.folder.name);
    const markFolderTarget = handleDragTarget(node.folder.id, node.folder.id);
    const childNotes = notesByFolderId.get(node.folder.id) || [];
    const hasChildren = node.children.length > 0 || childNotes.length > 0;
    const nextPath = parentPath ? `${parentPath}/${leafName}` : leafName;
    return (
      <div key={`${node.folder.id}-${folderTreeResetKey}`} className="relative">
        {templateMenuFolderId === node.folder.id && (
          <div
            data-template-menu
            className="absolute right-0 top-7 z-50 min-w-[168px] rounded-panel bg-[#F9F9F7] noa-floating-panel p-1 flex flex-col"
          >
            {builtinTemplates.map(t => {
              const TemplateIcon = templateMenuIcons[t.id] ?? FileText;
              return (
                <button
                  key={t.id}
                  className="noa-sidebar-hover-surface flex h-7 shrink-0 items-center gap-2.5 w-full rounded-md px-2 text-left text-body font-ui text-[var(--text-primary,#2D2D2B)] transition-colors"
                  onClick={() => {
                    onCreateNote(node.folder.id, applyTemplate(t, 'New Note'));
                    setTemplateMenuFolderId(null);
                  }}
                >
                  <TemplateIcon size={13} className="shrink-0 text-[var(--sidebar-text-muted,#898781)]" />
                  <span className="truncate">{t.name}</span>
                </button>
              );
            })}
          </div>
        )}
        <FileNode
        name={leafName}
        isFolder
        defaultOpen={foldersExpandedByDefault}
          icon={Folder}
          onAdd={() => setTemplateMenuFolderId(templateMenuFolderId === node.folder.id ? null : node.folder.id)}
          onAddFolder={() => onCreateFolder(node.folder.id)}
          onNewNote={() => onCreateNote(node.folder.id)}
          draggable
          onDragStart={handleDragStartItem('folder', node.folder.id, node.folder.name)}
          onDragEnter={markFolderTarget}
          onDragOver={markFolderTarget}
          onDrop={(e) => handleDropItem(node.folder.id, e)}
          onDragEnd={handleDragEndItem}
          isDropTarget={dropTargetId === node.folder.id}
          isDragging={draggingId === node.folder.id}
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
              isDragging={draggingId === note.id}
              onSelect={handleNoteRowSelect}
              onRequestDelete={handleNoteRowDelete}
              onRename={onRenameNote}
              onDuplicate={onDuplicateNote}
              onDragStart={handleDragStartItem}
              onDragEnd={handleDragEndItem}
            />
          ))}
          {/* 22px aligns with FileNode's icon column: 2 (child padding) + 16 (chevron) + 4 (gap). */}
          {!hasChildren && <div className="text-[var(--sidebar-text-muted,#898781)] py-1 font-ui" style={{ paddingLeft: '22px' }}>Empty</div>}
        </FileNode>
      </div>
    );
  }, [draggingId, dropTargetId, folderTreeResetKey, foldersExpandedByDefault, handleDragEndItem, handleDragTarget, handleDragStartItem, handleDropItem, handleNoteRowDelete, handleNoteRowSelect, notesByFolderId, onCreateFolder, onCreateNote, onDuplicateNote, onRenameNote, renameFolderWithValidation, selectedNoteIds, templateMenuFolderId]);

  useEffect(() => {
    if (!blankMenu) return;
    blankMenuRef.current?.querySelector('button')?.focus();
    const close = (event: Event) => {
      if (!blankMenuRef.current?.contains(event.target as Node)) setBlankMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [blankMenu]);

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

  // During drag events dataTransfer.files is empty (protected mode); only `types` reveals files. `files` fills at drop.
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
    // dragleave fires at every child boundary; only clear the overlay when leaving the sidebar itself.
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

  // The toolbar seam appears once the tree scrolls under it; the fade writes to the sidebar root since the overlay is the scroller's sibling.
  const sidebarRootRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = treeScrollRef.current;
    const root = sidebarRootRef.current;
    if (!scroller || !root) return;
    const fade = attachEdgeFade(scroller, { target: root });
    return () => fade.dispose();
  }, []);

  return (
    <div 
      ref={sidebarRootRef}
      className="noa-sidebar-surface w-full h-full min-h-0 flex flex-col shrink-0 relative"
      // Suppresses hover surfaces and row actions while a tree drag is in
      // flight, the way Obsidian gates them behind `body:not(.is-grabbing)`.
      data-grabbing={draggingId ? 'true' : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 bg-[#CC7D5E]/10 border-2 border-dashed border-[#CC7D5E] z-50 flex items-center justify-center pointer-events-none">
          <div className="noa-floating-panel bg-[#F9F9F7] px-4 py-2 border border-[#CC7D5E] font-ui text-[#CC7D5E] flex items-center">
            <Plus size={16} className="mr-2" />
            Drop files to import
          </div>
        </div>
      )}
      {/* Vertical rhythm by centre line: titlebar 22px, this row 60px, first tree row ~98px — two equal 38px steps. */}
      <div className="noa-sidebar-toolbar-mask h-8 flex items-center pl-[10px] pr-2 gap-0.5 shrink-0 z-10 overflow-visible">
        <button
          onClick={() => onCreateNote(blankCreateTarget)}
          className="flex size-6 items-center justify-center rounded-md noa-sidebar-hover-surface text-[var(--sidebar-text,#52514E)] hover:text-[#2D2D2B] transition-colors noa-press"
          title="New note  ⌘N"
          aria-label="New note"
        >
          <SquarePen size={14} />
        </button>
        <button
          onClick={() => onCreateFolder(blankCreateTarget === VAULT_ROOT_FOLDER_ID ? VAULT_ROOT_FOLDER_ID : undefined)}
          className="flex size-6 items-center justify-center rounded-md noa-sidebar-hover-surface text-[var(--sidebar-text,#52514E)] hover:text-[#2D2D2B] transition-colors noa-press"
          title="New folder"
          aria-label="New folder"
        >
          <FolderPlus size={16} />
        </button>
        {dailyNotesEnabled && (
        <button
          onClick={() => onOpenDailyNote?.()}
          className="flex size-6 items-center justify-center rounded-md noa-sidebar-hover-surface text-[var(--sidebar-text,#52514E)] hover:text-[#2D2D2B] transition-colors noa-press"
          title="Open today's daily note  ⌘⇧K"
          aria-label="Open today's daily note"
        >
          <Calendar size={13.5} />
        </button>
        )}
        <button
          onClick={() => {
            if (notes.length === 0) return;
            const randomNote = notes[Math.floor(Math.random() * notes.length)];
            onSelectNote(randomNote.id);
          }}
          className="flex size-6 items-center justify-center rounded-md noa-sidebar-hover-surface text-[var(--sidebar-text,#52514E)] hover:text-[#2D2D2B] transition-colors noa-press"
          title="Open random note"
          aria-label="Open random note"
        >
          <Dices size={14.5} />
        </button>
        <button
          onClick={() => {
            setFoldersExpandedByDefault((value) => !value);
            setFolderTreeResetKey((value) => value + 1);
          }}
          className="flex size-6 items-center justify-center rounded-md noa-sidebar-hover-surface text-[var(--sidebar-text,#52514E)] hover:text-[#2D2D2B] transition-colors noa-press"
          title={foldersExpandedByDefault ? 'Collapse all folders' : 'Expand all folders'}
          aria-label={foldersExpandedByDefault ? 'Collapse all folders' : 'Expand all folders'}
        >
          {foldersExpandedByDefault ? <ChevronsDownUp size={13.5} /> : <ChevronsUpDown size={13.5} />}
        </button>
      </div>

      {pendingDelete && (
        <div className="noa-confirm-reveal bg-[#CC7D5E]/10 px-3 py-2.5 flex flex-col gap-2 font-ui shrink-0 z-10">
          <p className="text-xs leading-relaxed text-[#2D2D2B]">
            Delete "{pendingDelete.name}"?{' '}
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
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (pendingDelete.type === 'note') onDeleteNote(pendingDelete.id);
                else onDeleteFolder(pendingDelete.id);
                setPendingDelete(null);
              }}
              className="h-6 rounded-md px-3 text-xs min-w-16 text-center bg-[#D45555] text-white border border-transparent shadow-[0_1px_2px_rgba(45,45,43,0.12)] transition-opacity hover:opacity-90 noa-press"
            >
              Delete
            </button>
            <button
              onClick={() => setPendingDelete(null)}
              className="noa-confirm-btn noa-sidebar-hover-surface h-6 rounded-md px-3 text-xs min-w-16 text-center bg-[#F9F9F7] border border-[var(--divider-subtle)] transition-colors noa-press"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bulk selection action bar */}
      {selectedNoteIds.size > 0 && (
        <div className="bg-[#CC7D5E]/10 px-3 py-1.5 flex items-center justify-between shrink-0 font-ui">
          <span className="text-xs text-[var(--sidebar-text,#52514E)]">{selectedNoteIds.size} selected</span>
          <div className="flex items-center gap-1.5">
            {!pendingBulkDelete ? (
              <>
                <button
                  onClick={() => setPendingBulkDelete(true)}
                  className="noa-confirm-btn px-2 py-0.5 text-xs min-w-16 text-center bg-[#D45555] text-white border border-[var(--divider-subtle)] hover:opacity-90 noa-press"
                >
                  Delete
                </button>
                <button
                  onClick={() => setSelectedNoteIds(new Set())}
                  className="noa-confirm-btn noa-sidebar-hover-surface px-2 py-0.5 text-xs min-w-16 text-center bg-[#F9F9F7] border border-[var(--divider-subtle)] noa-press"
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
                  className="noa-confirm-btn px-2 py-0.5 text-xs min-w-16 text-center bg-[#D45555] text-white border border-[var(--divider-subtle)] hover:opacity-90 noa-press"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setPendingBulkDelete(false)}
                  className="noa-confirm-btn noa-sidebar-hover-surface px-2 py-0.5 text-xs min-w-16 text-center bg-[#F9F9F7] border border-[var(--divider-subtle)] noa-press"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {blankMenu && createPortal(
        <div
          ref={blankMenuRef}
          role="menu"
          aria-label="Sidebar actions"
          className="fixed z-[90] w-44 rounded-panel bg-[#F9F9F7] p-1 font-ui noa-floating-panel"
          style={{ left: blankMenu.x, top: blankMenu.y }}
          onKeyDown={(e) => { if (e.key === 'Escape') setBlankMenu(null); }}
        >
          <button
            role="menuitem"
            className="noa-sidebar-hover-surface flex h-8 w-full items-center rounded-lg px-2.5 text-left text-body text-[#2D2D2B]"
            onClick={() => { setBlankMenu(null); onCreateNote(blankCreateTarget); }}
          >
            New note
          </button>
          <button
            role="menuitem"
            className="noa-sidebar-hover-surface flex h-8 w-full items-center rounded-lg px-2.5 text-left text-body text-[#2D2D2B]"
            onClick={() => { setBlankMenu(null); onCreateFolder(blankCreateTarget === VAULT_ROOT_FOLDER_ID ? VAULT_ROOT_FOLDER_ID : undefined); }}
          >
            New folder
          </button>
        </div>,
        document.body,
      )}

      {/* Main Content Section */}
      <div
        ref={treeScrollRef}
        className="noa-sidebar-scroll noa-sidebar-scroll-fade flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        // Rows stop propagation of their own context menu, so this only sees blank space.
        onContextMenu={searchQuery ? undefined : (e) => {
          e.preventDefault();
          setBlankMenu({
            x: Math.max(8, Math.min(e.clientX, window.innerWidth - 184)),
            y: Math.max(8, Math.min(e.clientY, window.innerHeight - 72)),
          });
        }}
      >
        <div className="pt-1 pb-2">
          {searchQuery ? (
              <div>
                <div className="text-xs text-[var(--sidebar-text-muted,#898781)] mb-2 px-2 font-ui flex items-center justify-between">
                  <span>Search results <span className="tabular-nums">{searchResults.length}</span></span>
                  {onClearSearch && (
                    <button
                      onClick={onClearSearch}
                      className="noa-sidebar-hover-surface text-[var(--sidebar-text-muted,#898781)] hover:text-[#CC7D5E] noa-press shrink-0 -mr-1 p-1 rounded"
                      title="Close search"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                {searchResults.map(result => (
                  <div
                    key={result.note.id}
                    data-testid="search-result"
                    className={`p-2 mx-1.5 mb-1.5 rounded-md cursor-pointer ${activeNoteId === result.note.id ? 'noa-ink-selected' : 'noa-sidebar-hover-surface-subtle'} transition-colors`}
                    onClick={() => onSelectNote(result.note.id)}
                  >
                    <div className="font-ui text-sm text-[#2D2D2B] mb-1 flex items-center">
                      <FileText size={12} className="mr-1.5 text-[#CC7D5E] shrink-0" />
                      <span className="truncate">
                        {result.titleSnippet ? <HighlightedText text={result.titleSnippet} /> : 'Untitled'}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--sidebar-text,#52514E)] font-ui leading-relaxed break-words line-clamp-2">
                      <HighlightedText text={result.contentSnippet} />
                    </div>
                    {result.note.tags && result.note.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {result.note.tags.map(tag => (
                          <span key={tag} className="noa-tag-similar rounded-sm px-1 text-micro font-ui">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {searchResults.length === 0 && (
                  <div className="noa-hint-in text-[var(--sidebar-text-muted,#898781)] px-2 py-4 font-ui text-sm text-center">
                    No matches found
                  </div>
                )}
              </div>
            ) : (
              <>
              <div data-testid="sidebar-file-tree" className="pt-0.5">
                {/* Noa-native notes — flat root, no wrapper node */}
                <div
                  onDragEnter={markNoaRootTarget}
                  onDragOver={markNoaRootTarget}
                  onDrop={(e) => handleDropItem(null, e)}
                  className={dropTargetId === NOA_ROOT_DROP_TARGET_ID ? 'noa-sidebar-drop-root' : ''}
                >
                  {noaFolderTree.map((node) => renderFolderNode(node, 0, activeNoteId))}
                  {rootNoaNotes.map((note) => (
                    <SidebarNoteRow
                      key={note.id}
                      note={note}
                      depth={0}
                      isActive={activeNoteId === note.id}
                      isSelected={selectedNoteIds.has(note.id)}
                      isDragging={draggingId === note.id}
                      onSelect={handleNoteRowSelect}
                      onRequestDelete={handleNoteRowDelete}
                      onRename={onRenameNote}
                      onDuplicate={onDuplicateNote}
                      onDragStart={handleDragStartItem}
                      onDragEnd={handleDragEndItem}
                    />
                  ))}
                </div>

                {/* Connected vault section — ownership is origin, not import provenance. */}
                {(vaultFolderTree.length > 0 || rootVaultNotes.length > 0) && (
                  <>
                    {/* Top padding only separates it from Noa rows above; with none, the toolbar gap already does. */}
                    <div className={`mx-2 pl-2 pr-2 pb-3 ${noaFolderTree.length > 0 || rootNoaNotes.length > 0 ? 'pt-3' : ''}`}>
                      <span className="text-micro uppercase tracking-widest text-[var(--sidebar-text-muted,#898781)] font-ui">Obsidian Vault</span>
                    </div>
                    <div
                      onDragEnter={markVaultRootTarget}
                      onDragOver={markVaultRootTarget}
                      onDrop={(e) => handleDropItem(null, e, true)}
                      onDragEnd={handleDragEndItem}
                      className={dropTargetId === IMPORT_ROOT_DROP_TARGET_ID ? 'noa-sidebar-drop-root' : ''}
                    >
                      {vaultFolderTree.map((node) => renderFolderNode(node, 0, activeNoteId))}
                      {rootVaultNotes.map((note) => (
                        <SidebarNoteRow
                          key={note.id}
                          note={note}
                          depth={0}
                          isActive={activeNoteId === note.id}
                          isSelected={selectedNoteIds.has(note.id)}
                          isDragging={draggingId === note.id}
                          onSelect={handleNoteRowSelect}
                          onRequestDelete={handleNoteRowDelete}
                          onRename={onRenameNote}
                          onDuplicate={onDuplicateNote}
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

      <VaultFooter
        {...vault}
      />
    </div>
  );
}
