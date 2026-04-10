import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronRight, ChevronDown, FileText, Plus, Folder, FolderPlus, Calendar, SquarePen, ChevronsDownUp, ChevronsUpDown, ArrowUpDown, Dices } from 'lucide-react';
import { Note, Folder as FolderType } from '../types';
import { builtinTemplates, applyTemplate } from '../lib/templates';
import { classifyFolderImportFile } from '../lib/importUtils';
import { getFolderLeafName, getFolderParentPath } from '../lib/pathUtils';
import CalendarPanel from './CalendarPanel';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { FileNode, buildFolderTree, FolderTreeNode } from './sidebar/FileNode';
import { TagBrowser } from './sidebar/TagBrowser';
import { useSidebarDrag } from '../hooks/useSidebarDrag';
import { useSidebarSearch } from '../hooks/useSidebarSearch';
import { lsGet, lsSet } from '../lib/safeLocalStorage';

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

interface SidebarProps {
  notes: Note[];
  folders: FolderType[];
  searchQuery: string;
  activeNoteId: string;
  recentNoteIds?: string[];
  onSelectNote: (id: string) => void;
  onCreateNote: (folderId: string, initialContent?: string) => void;
  onDeleteNote: (id: string) => void;
  onRenameNote: (id: string, newName: string) => void;
  onMoveNote: (id: string, folderId: string) => void;
  onCreateFolder: (parentFolderId?: string) => void;
  onRenameFolder: (id: string, newName: string) => void;
  onDeleteFolder: (id: string) => void;
  onUpdateNoteContent?: (id: string, content: string) => void;
  onOpenDailyNote?: (targetDate?: string) => void;
  onImportNote?: (title: string, content: string, folderId?: string, attachmentFile?: File | null) => void;
  onSearchTag?: (tag: string) => void;
  caseSensitive?: boolean;
  fuzzySearch?: boolean;
  dateFormat?: string;
}

export default function Sidebar({
  notes, folders, searchQuery, activeNoteId, recentNoteIds = [],
  onSelectNote, onCreateNote, onDeleteNote, onRenameNote,
  onMoveNote, onCreateFolder, onRenameFolder, onDeleteFolder,
  onUpdateNoteContent, onOpenDailyNote,
  onImportNote, onSearchTag, caseSensitive = false, fuzzySearch = true, dateFormat = 'YYYY-MM-DD',
}: SidebarProps) {

  const [pendingDelete, setPendingDelete] = useState<{ type: 'note' | 'folder'; id: string; name: string } | null>(null);
  const [foldersExpandedByDefault, setFoldersExpandedByDefault] = useState(false);
  const [folderTreeResetKey, setFolderTreeResetKey] = useState(0);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [templateMenuFolderId, setTemplateMenuFolderId] = useState<string | null>(null);
  const resolveFolderSource = useCallback((folder: FolderType) => folder.source ?? 'noa', []);

  const searchResults = useSidebarSearch({ notes, folders, searchQuery, caseSensitive, fuzzySearch });

  const {
    draggedItem,
    dropTargetId,
    dropPosition,
    handleDropItem,
    handleDragStartItem,
    handleDragEndItem,
    handleDragOverTarget,
    handleDragEnterTarget,
  } = useSidebarDrag({ notes, folders, onMoveNote, onRenameFolder });
  const noaFolders = useMemo(() => folders.filter((folder) => resolveFolderSource(folder) === 'noa'), [folders, resolveFolderSource]);
  const importedFolders = useMemo(() => folders.filter((folder) => resolveFolderSource(folder) === 'obsidian-import'), [folders, resolveFolderSource]);
  const noaFolderTree = useMemo(() => buildFolderTree(noaFolders), [noaFolders]);
  const importedFolderTree = useMemo(() => buildFolderTree(importedFolders), [importedFolders]);
  const notesByFolderId = useMemo(() => {
    const map = new Map<string, Note[]>();
    notes.forEach((note) => {
      const key = note.folder || '';
      const list = map.get(key) || [];
      list.push(note);
      map.set(key, list);
    });
    return map;
  }, [notes]);
  const primaryNoaFolderId = useMemo(
    () => (folders.find((folder) => resolveFolderSource(folder) === 'noa')?.id ?? folders[0]?.id ?? ''),
    [folders, resolveFolderSource]
  );

  const renameFolderWithValidation = useCallback((id: string, nextPath: string): string | void => {
    const targetFolder = folders.find((folder) => folder.id === id);
    if (!targetFolder) return 'Folder not found.';
    const normalizedNextPath = nextPath.trim() || 'Untitled Folder';
    const nextParentPath = getFolderParentPath(normalizedNextPath);
    const nextLeafName = getFolderLeafName(normalizedNextPath).toLocaleLowerCase();
    const targetSource = resolveFolderSource(targetFolder);
    const conflict = folders.some((folder) => {
      if (folder.id === id) return false;
      if (resolveFolderSource(folder) !== targetSource) return false;
      if (getFolderParentPath(folder.name) !== nextParentPath) return false;
      return getFolderLeafName(folder.name).toLocaleLowerCase() === nextLeafName;
    });
    if (conflict) return 'A folder with this name already exists in this location.';
    onRenameFolder(id, normalizedNextPath);
  }, [folders, onRenameFolder, resolveFolderSource]);

  const getFolderSubtreeNoteCount = useCallback((folderPath: string) => {
    const targetIds = new Set(
      folders
        .filter((folder) => folder.name === folderPath || folder.name.startsWith(`${folderPath}/`))
        .map((folder) => folder.id)
    );
    return notes.filter((note) => targetIds.has(note.folder)).length;
  }, [folders, notes]);

  type NoteSortOrder = 'updatedAt' | 'createdAt' | 'name';
  const [noteSortOrder, setNoteSortOrder] = useState<NoteSortOrder>(() =>
    (lsGet(STORAGE_KEYS.NOTE_SORT_ORDER) as NoteSortOrder) || 'updatedAt'
  );
  useEffect(() => { lsSet(STORAGE_KEYS.NOTE_SORT_ORDER, noteSortOrder); }, [noteSortOrder]);

  const sortNotes = useCallback((arr: Note[]) => {
    if (noteSortOrder === 'name') return [...arr].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (noteSortOrder === 'createdAt') return [...arr].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return [...arr].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [noteSortOrder]);

  const renderFolderNode = useCallback((node: FolderTreeNode, depth: number, activeId: string, parentPath: string = '') => {
    const leafName = getFolderLeafName(node.folder.name);
    const folderSource = resolveFolderSource(node.folder);
    const canCreateInsideFolder = folderSource === 'noa';
    const childNotes = sortNotes(notesByFolderId.get(node.folder.id) || []);
    const hasChildren = node.children.length > 0 || childNotes.length > 0;
    const nextPath = parentPath ? `${parentPath}/${leafName}` : leafName;
    return (
      <div key={`${node.folder.id}-${folderTreeResetKey}`} className="relative">
        {templateMenuFolderId === node.folder.id && (
          <div
            data-template-menu
            className="absolute right-0 top-7 z-50 bg-[#EAE8E0] border-2 border-[#2D2D2D] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] min-w-[160px]"
          >
            {builtinTemplates.map(t => (
              <button
                key={t.id}
                className="w-full text-left px-3 py-1.5 text-sm font-redaction hover:bg-[#DCD9CE] text-[#2D2D2D]"
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
          dropPosition={dropTargetId === node.folder.id ? dropPosition : null}
          addButtonProps={{ 'data-template-btn': node.folder.id }}
          onRename={(newName: string) => renameFolderWithValidation(node.folder.id, parentPath ? `${parentPath}/${newName}` : newName)}
          onDelete={() => setPendingDelete({ type: 'folder', id: node.folder.id, name: node.folder.name })}
          depth={depth}
        >
          {node.children.map((child) => renderFolderNode(child, depth + 1, activeId, nextPath))}
          {childNotes.map((note) => (
              <FileNode
              key={note.id}
              name={(note.title || 'Untitled') + '.md'}
              isActive={activeId === note.id}
              isSelected={selectedNoteIds.has(note.id)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) {
                  setSelectedNoteIds(prev => {
                    const next = new Set(prev);
                    if (next.has(note.id)) next.delete(note.id);
                    else next.add(note.id);
                    return next;
                  });
                } else {
                  setSelectedNoteIds(new Set());
                  onSelectNote(note.id);
                }
              }}
              onDelete={() => setPendingDelete({ type: 'note', id: note.id, name: note.title || 'Untitled' })}
              onRename={(newName: string) => onRenameNote(note.id, newName)}
              iconColor="#B89B5E"
              draggable
              onDragStart={handleDragStartItem('note', note.id, note.title || 'Untitled')}
              onDragEnd={handleDragEndItem}
              depth={depth + 1}
            />
          ))}
          {!hasChildren && <div className="text-[#2D2D2D]/50 py-1 font-redaction text-sm" style={{ paddingLeft: `${(depth + 2) * 12}px` }}>Empty</div>}
        </FileNode>
      </div>
    );
  }, [dropPosition, dropTargetId, folderTreeResetKey, foldersExpandedByDefault, handleDragEndItem, handleDragEnterTarget, handleDragOverTarget, handleDragStartItem, handleDropItem, notesByFolderId, onCreateFolder, onCreateNote, onDeleteFolder, onRenameNote, onSelectNote, renameFolderWithValidation, resolveFolderSource, selectedNoteIds, templateMenuFolderId, sortNotes]);

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

  const isFileImportDrag = (e: React.DragEvent) => e.dataTransfer.files.length > 0;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (isFileImportDrag(e)) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (isFileImportDrag(e)) {
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
      className="w-full h-full border-r border-[#2D2D2D] flex flex-col bg-[#EAE8E0] shrink-0 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 bg-[#B89B5E]/10 border-2 border-dashed border-[#B89B5E] z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-[#EAE8E0] px-4 py-2 border border-[#B89B5E] shadow-lg font-redaction font-bold text-[#B89B5E] flex items-center">
            <Plus size={16} className="mr-2" />
            Drop files to import
          </div>
        </div>
      )}
          {pendingDelete && (
        <div className="slide-down border-b-2 border-[#B89B5E] bg-[#B89B5E]/10 px-3 py-2 flex flex-col gap-1.5 font-redaction shrink-0 z-10">
          <p className="text-xs text-[#2D2D2D]">
            Delete "<span className="font-bold">{pendingDelete.name}</span>"?{' '}
            {pendingDelete.type === 'folder'
              ? (() => {
                  const target = folders.find((folder) => folder.id === pendingDelete.id);
                  const count = target ? getFolderSubtreeNoteCount(target.name) : notes.filter(n => n.folder === pendingDelete.id).length;
                  if (count > 0) {
                    const subtreeIds = new Set(
                      folders
                        .filter((f) => f.id === target?.id || f.name.startsWith((target?.name ?? '') + '/'))
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
              onClick={() => { pendingDelete.type === 'note' ? onDeleteNote(pendingDelete.id) : onDeleteFolder(pendingDelete.id); setPendingDelete(null); }}
              className="px-2 py-0.5 text-xs font-bold bg-red-500 text-white border border-[#2D2D2D] hover:opacity-90 active:opacity-70"
            >
              Delete
            </button>
            <button
              onClick={() => setPendingDelete(null)}
              className="px-2 py-0.5 text-xs font-bold bg-[#EAE8E0] border border-[#2D2D2D] hover:bg-[#DCD9CE]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="h-8 border-b border-[#2D2D2D] flex items-center px-2 gap-0.5 shrink-0 bg-[#DCD9CE] z-10 overflow-hidden">
        <button
          onClick={() => onCreateNote(primaryNoaFolderId)}
          className="p-1 text-[#2D2D2D]/70 hover:text-[#B89B5E] transition-colors active:opacity-70"
          title="New note"
        >
          <SquarePen size={14} />
        </button>
        <button
          onClick={() => onCreateFolder()}
          className="p-1 text-[#2D2D2D]/70 hover:text-[#B89B5E] transition-colors active:opacity-70"
          title="New folder"
        >
          <FolderPlus size={14} />
        </button>
        <button
          onClick={() => {
            setFoldersExpandedByDefault((value) => !value);
            setFolderTreeResetKey((value) => value + 1);
          }}
          className="p-1 text-[#2D2D2D]/70 hover:text-[#B89B5E] transition-colors active:opacity-70"
          title={foldersExpandedByDefault ? 'Collapse all folders' : 'Expand all folders'}
        >
          {foldersExpandedByDefault ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
        </button>
        <button
          onClick={() => onOpenDailyNote?.()}
          className="p-1 text-[#2D2D2D]/70 hover:text-[#B89B5E] transition-colors active:opacity-70"
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
          className="p-1 text-[#2D2D2D]/70 hover:text-[#B89B5E] transition-colors active:opacity-70"
          title="Open random note"
        >
          <Dices size={14} />
        </button>
        <button
          onClick={() => setNoteSortOrder(o => o === 'updatedAt' ? 'createdAt' : o === 'createdAt' ? 'name' : 'updatedAt')}
          className="flex items-center gap-1 px-1 py-1 transition-colors active:opacity-70 ml-auto text-[#2D2D2D]/50 hover:text-[#B89B5E]"
          style={{ color: noteSortOrder !== 'updatedAt' ? '#B89B5E' : undefined }}
          title="Click to cycle sort order"
        >
          <ArrowUpDown size={14} />
          <span className="text-[10px] uppercase tracking-wide leading-none">
            {noteSortOrder === 'updatedAt' ? 'Modified' : noteSortOrder === 'createdAt' ? 'Created' : 'Name'}
          </span>
        </button>
      </div>
      
      {/* Bulk selection action bar */}
      {selectedNoteIds.size > 0 && (
        <div className="border-b border-[#2D2D2D]/20 bg-[#B89B5E]/10 px-3 py-1.5 flex items-center justify-between shrink-0 font-redaction">
          <span className="text-xs text-[#2D2D2D]/70">{selectedNoteIds.size} selected</span>
          <div className="flex items-center gap-1.5">
            {!pendingBulkDelete ? (
              <>
                <button
                  onClick={() => setPendingBulkDelete(true)}
                  className="px-2 py-0.5 text-xs font-bold bg-red-500 text-white border border-[#2D2D2D] hover:opacity-90 active:opacity-70"
                >
                  Delete
                </button>
                <button
                  onClick={() => setSelectedNoteIds(new Set())}
                  className="px-2 py-0.5 text-xs font-bold bg-[#EAE8E0] border border-[#2D2D2D] hover:bg-[#DCD9CE] active:opacity-70"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-red-600">Delete {selectedNoteIds.size} note{selectedNoteIds.size !== 1 ? 's' : ''}?</span>
                <button
                  onClick={() => {
                    selectedNoteIds.forEach(id => onDeleteNote(id));
                    setSelectedNoteIds(new Set());
                    setPendingBulkDelete(false);
                  }}
                  className="px-2 py-0.5 text-xs font-bold bg-red-500 text-white border border-[#2D2D2D] hover:opacity-90 active:opacity-70"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setPendingBulkDelete(false)}
                  className="px-2 py-0.5 text-xs font-bold bg-[#EAE8E0] border border-[#2D2D2D] hover:bg-[#DCD9CE] active:opacity-70"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main Content Section */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-2">
          {searchQuery ? (
              <div className="px-2">
                <div className="text-xs text-[#2D2D2D]/50 mb-2 px-2 font-redaction uppercase tracking-wider">
                  Search Results ({searchResults.length})
                </div>
                {searchResults.map(result => (
                  <div 
                    key={result.note.id}
                    className={`p-2 mb-1 cursor-pointer border ${activeNoteId === result.note.id ? 'bg-[#DCD9CE] border-[#B89B5E]' : 'border-transparent hover:bg-[#DCD9CE]/50'} transition-colors`}
                    onClick={() => onSelectNote(result.note.id)}
                  >
                    <div className="font-bold font-redaction text-sm text-[#2D2D2D] mb-1 flex items-center">
                      <FileText size={12} className="mr-1.5 text-[#B89B5E] shrink-0" />
                      <span className="truncate">
                        {result.titleSnippet ? <HighlightedText text={result.titleSnippet} /> : 'Untitled'}
                      </span>
                    </div>
                    <div className="text-xs text-[#2D2D2D]/70 font-redaction leading-relaxed break-words line-clamp-2">
                      <HighlightedText text={result.contentSnippet} />
                    </div>
                    {result.note.tags && result.note.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {result.note.tags.map(tag => (
                          <span key={tag} className="text-[10px] font-redaction text-[#B89B5E] bg-[#B89B5E]/10 px-1">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {searchResults.length === 0 && (
                  <div className="text-[#2D2D2D]/50 px-2 py-4 font-redaction text-sm text-center">
                    No matches found
                  </div>
                )}
              </div>
            ) : (
              <>
              <div data-testid="sidebar-file-tree">
                {/* Noa-native notes — flat root, no wrapper node */}
                <div
                  onDragEnter={handleDragEnterTarget(NOA_ROOT_DROP_TARGET_ID)}
                  onDragOver={handleDragOverTarget(NOA_ROOT_DROP_TARGET_ID)}
                  onDrop={(e) => handleDropItem(null, e)}
                  onDragLeave={() => handleDragEndItem()}
                  className={dropTargetId === NOA_ROOT_DROP_TARGET_ID ? 'ring-1 ring-inset ring-[#B89B5E]/50' : ''}
                >
                  {noaFolderTree.map((node) => renderFolderNode(node, 0, activeNoteId))}
                  {sortNotes((notesByFolderId.get('') || []).filter((note) => (note.source ?? 'noa') === 'noa')).map((note) => (
                    <FileNode
                      key={note.id}
                      name={(note.title || 'Untitled') + '.md'}
                      isActive={activeNoteId === note.id}
                      isSelected={selectedNoteIds.has(note.id)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) {
                          setSelectedNoteIds(prev => {
                            const next = new Set(prev);
                            if (next.has(note.id)) next.delete(note.id);
                            else next.add(note.id);
                            return next;
                          });
                        } else {
                          setSelectedNoteIds(new Set());
                          onSelectNote(note.id);
                        }
                      }}
                      onDelete={() => setPendingDelete({ type: 'note', id: note.id, name: note.title || 'Untitled' })}
                      onRename={(newName: string) => onRenameNote(note.id, newName)}
                      iconColor="#B89B5E"
                      draggable
                      onDragStart={handleDragStartItem('note', note.id, note.title || 'Untitled')}
                      onDragEnd={handleDragEndItem}
                      depth={0}
                    />
                  ))}
                </div>

                {/* Obsidian Vault section — only shown when imported content exists */}
                {(importedFolderTree.length > 0 || (notesByFolderId.get('') || []).some((note) => (note.source ?? 'noa') === 'obsidian-import')) && (
                  <>
                    <div className="flex items-center gap-2 px-2 py-1.5 mt-1">
                      <div className="flex-1 border-t border-[#2D2D2D]/20" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#2D2D2D]/40 font-redaction shrink-0">Obsidian Vault</span>
                      <div className="flex-1 border-t border-[#2D2D2D]/20" />
                    </div>
                    <div
                      onDragEnter={handleDragEnterTarget(IMPORT_ROOT_DROP_TARGET_ID)}
                      onDragOver={handleDragOverTarget(IMPORT_ROOT_DROP_TARGET_ID)}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDragEndItem();
                      }}
                      onDragEnd={handleDragEndItem}
                    >
                      {importedFolderTree.map((node) => renderFolderNode(node, 0, activeNoteId))}
                      {sortNotes((notesByFolderId.get('') || []).filter((note) => (note.source ?? 'noa') === 'obsidian-import')).map((note) => (
                        <FileNode
                          key={note.id}
                          name={(note.title || 'Untitled') + '.md'}
                          isActive={activeNoteId === note.id}
                          isSelected={selectedNoteIds.has(note.id)}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey) {
                              setSelectedNoteIds(prev => {
                                const next = new Set(prev);
                                if (next.has(note.id)) next.delete(note.id);
                                else next.add(note.id);
                                return next;
                              });
                            } else {
                              setSelectedNoteIds(new Set());
                              onSelectNote(note.id);
                            }
                          }}
                          onDelete={() => setPendingDelete({ type: 'note', id: note.id, name: note.title || 'Untitled' })}
                          onRename={(newName: string) => onRenameNote(note.id, newName)}
                          iconColor="#B89B5E"
                          draggable
                          onDragStart={handleDragStartItem('note', note.id, note.title || 'Untitled')}
                          onDragEnd={handleDragEndItem}
                          depth={0}
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

      {/* Calendar Panel */}
      {!searchQuery && (
        <CalendarPanel
          notes={notes}
          activeNoteId={activeNoteId}
          onSelectDate={(dateStr) => onOpenDailyNote?.(dateStr)}
          dateFormat={dateFormat}
        />
      )}

      <TagBrowser notes={notes} onSearchTag={onSearchTag} />
    </div>
  );
}
