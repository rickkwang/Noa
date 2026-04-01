import React, { useState, useEffect, useRef, useMemo, useDeferredValue, useCallback } from 'react';
import { useResizeDrag } from '../hooks/useResizeDrag';
import { ChevronRight, ChevronDown, FileText, Plus, Trash2, Folder, FolderPlus, Settings, Calendar, AlertCircle, ArrowUpRight, CheckSquare, Hash, X, SquarePen, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { Note, Folder as FolderType } from '../types';
import { SearchEngine, SearchResult } from '../core/search';
import { builtinTemplates, applyTemplate } from '../lib/templates';
import { classifyFolderImportFile } from '../hooks/useDataTransfer';
import { getFolderLeafName, getFolderParentPath, isDescendantPath } from '../lib/pathUtils';
import DOMPurify from 'dompurify';
import CalendarPanel from './CalendarPanel';

const HIGHLIGHT_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong'],
  ALLOWED_ATTR: [],
};

function sanitizeHighlightHtml(input: string | null | undefined): string {
  if (!input) return '';
  return DOMPurify.sanitize(input, HIGHLIGHT_SANITIZE_CONFIG);
}

function isInlinePreviewableAttachment(file: File): boolean {
  return file.type.startsWith('image/')
    || /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico|tif|tiff)$/i.test(file.name);
}

interface FileNodeProps {
  name: string;
  isFolder?: boolean;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  isActive?: boolean;
  isSelected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDelete?: () => void;
  onRename?: (newName: string) => string | void;
  icon?: React.ElementType;
  iconColor?: string;
  onAdd?: () => void;
  onAddFolder?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isDropTarget?: boolean;
  dropPosition?: 'top' | 'bottom' | null;
  addButtonProps?: Record<string, unknown>;
  depth?: number;
}

interface FolderTreeNode {
  folder: FolderType;
  children: FolderTreeNode[];
}

const ROOT_DROP_TARGET_ID = '__root__';
const NOA_ROOT_DROP_TARGET_ID = '__root_noa__';
const IMPORT_ROOT_DROP_TARGET_ID = '__root_import__';

function buildFolderTree(folders: FolderType[]): FolderTreeNode[] {
  const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name));
  const nodeByPath = new Map<string, FolderTreeNode>();
  const roots: FolderTreeNode[] = [];

  for (const folder of sorted) {
    const node: FolderTreeNode = { folder, children: [] };
    nodeByPath.set(folder.name, node);
  }

  for (const folder of sorted) {
    const node = nodeByPath.get(folder.name);
    if (!node) continue;
    const parentPath = getFolderParentPath(folder.name);
    const parent = parentPath ? nodeByPath.get(parentPath) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: FolderTreeNode[]) => {
    nodes.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

const FileNode = ({ name, isFolder, children, defaultOpen = false, isActive, isSelected, onClick, onDelete, onRename, icon: Icon = FileText, iconColor, onAdd, onAddFolder, draggable, onDragStart, onDragEnter, onDragOver, onDrop, onDragEnd, isDropTarget, dropPosition, addButtonProps = {}, depth = 0 }: FileNodeProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(name.replace('.md', ''));
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRename) {
      setIsEditing(true);
      setEditName(name.replace('.md', ''));
      setRenameError(null);
    }
  };

  const handleRenameSubmit = () => {
    const nextName = editName.trim();
    if (!nextName) {
      setRenameError('Name cannot be empty.');
      return;
    }
    if (nextName !== name.replace('.md', '')) {
      const error = onRename?.(nextName);
      if (typeof error === 'string' && error.length > 0) {
        setRenameError(error);
        return;
      }
    }
    setRenameError(null);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(name.replace('.md', ''));
      setRenameError(null);
    }
  };

  return (
    <div className="font-redaction">
      {isDropTarget && dropPosition === 'top' && (
        <div
          className="h-1 bg-[#B89B5E] ml-2"
          style={{ marginLeft: `${depth === 0 ? 4 : 2}px` }}
        />
      )}
      <div
        className={`flex items-center justify-between py-1 px-2 cursor-pointer select-none group ${
          isDropTarget
            ? 'bg-[#B89B5E]/16 ring-2 ring-inset ring-[#B89B5E] shadow-[inset_0_0_0_1px_rgba(184,155,94,0.45)]'
            : isSelected
              ? 'bg-[#B89B5E]/20 border-l-2 border-[#B89B5E]'
              : (isActive ? 'bg-[#EAE8E0]' : 'hover:bg-[#DCD9CE]/50')
        }`}
        style={{ paddingLeft: `${depth === 0 ? 4 : 2}px` }}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          if (isFolder) setIsOpen(!isOpen);
          if (onClick) onClick(e);
        }}
        onDoubleClick={handleDoubleClick}
      >
        <div className="flex items-center overflow-hidden flex-1">
          <span className="w-4 flex justify-center mr-1 shrink-0 text-[#2D2D2D]/50">
            {isFolder ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
          </span>
          <span className={`mr-2 shrink-0 ${isFolder ? 'text-[#B89B5E]' : (isActive ? 'text-[#B89B5E]' : (iconColor ? '' : 'text-[#2D2D2D]'))}`} style={iconColor && !isActive ? { color: iconColor } : {}}>
            <Icon size={14} fill={isFolder ? "currentColor" : "none"} />
          </span>
          {isEditing ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => {
                setEditName(e.target.value);
                if (renameError) setRenameError(null);
              }}
              onBlur={handleRenameSubmit}
              onKeyDown={handleKeyDown}
              className="bg-transparent border-b border-[#2D2D2D] outline-none w-full text-[#2D2D2D] font-redaction"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className={`truncate ${isActive ? 'font-bold' : ''}`}>
              {name}
            </span>
          )}
        </div>
        <div className="flex items-center opacity-0 group-hover:opacity-100 shrink-0 ml-2">
          {isFolder && onAddFolder && (
            <button
              onClick={(e) => { e.stopPropagation(); onAddFolder(); }}
              className="hover:text-[#B89B5E] p-1"
              title="Add subfolder"
            >
              <FolderPlus size={14} />
            </button>
          )}
          {isFolder && onAdd && (
            <button
              {...addButtonProps}
              onClick={(e) => { e.stopPropagation(); onAdd(); }}
              className="hover:text-[#B89B5E] p-1"
              title="Add"
            >
              <Plus size={14} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="hover:text-red-500 p-1"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {isDropTarget && dropPosition === 'bottom' && (
        <div
          className="h-1 bg-[#B89B5E] ml-2"
          style={{ marginLeft: `${depth === 0 ? 4 : 2}px` }}
        />
      )}
      {isEditing && renameError && (
        <div className="px-2 pt-1 text-[10px] text-red-600 font-redaction leading-snug">
          {renameError}
        </div>
      )}
      {isFolder && children && (
        <div
          className={`border-l border-[#2D2D2D]/15 overflow-hidden transition-[max-height,opacity] duration-150 ease-in-out ${
            isOpen ? 'max-h-[999px] opacity-100' : 'max-h-0 opacity-0'
          }`}
          style={{ marginLeft: `18px` }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

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
  const [isRecentOpen, setIsRecentOpen] = useState(true);
  const [foldersExpandedByDefault, setFoldersExpandedByDefault] = useState(false);
  const [folderTreeResetKey, setFolderTreeResetKey] = useState(0);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchEngineRef = useRef<SearchEngine | null>(null);
  const [templateMenuFolderId, setTemplateMenuFolderId] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<{ kind: 'note' | 'folder'; id: string; name: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'top' | 'bottom' | null>(null);
  const resolveNoteSource = useCallback((note: Note) => note.source ?? 'noa', []);
  const resolveFolderSource = useCallback((folder: FolderType) => folder.source ?? 'noa', []);
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
    if (conflict) {
      return 'A folder with this name already exists in this location.';
    }
    onRenameFolder(id, normalizedNextPath);
  }, [folders, onRenameFolder, resolveFolderSource]);

  const getFolderSubtreeNoteCount = useCallback((folderPath: string) => {
    const targetIds = new Set(
      folders
        .filter((folder) => isDescendantPath(folder.name, folderPath))
        .map((folder) => folder.id)
    );
    return notes.filter((note) => targetIds.has(note.folder)).length;
  }, [folders, notes]);

  const parseDraggedItem = useCallback((e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-noa-tree-item') || e.dataTransfer.getData('text/plain');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { kind: 'note' | 'folder'; id: string; name: string };
    } catch {
      return null;
    }
  }, []);

  const moveFolderToTarget = useCallback((folderId: string, targetFolderId: string | null) => {
    const source = folders.find((folder) => folder.id === folderId);
    if (!source) return;
    const sourceType = resolveFolderSource(source);
    if (targetFolderId) {
      const target = folders.find((folder) => folder.id === targetFolderId);
      if (!target) return;
      if (resolveFolderSource(target) !== sourceType) return;
    } else if (sourceType !== 'noa') {
      // Root drops are only valid in Noa workspace to avoid cross-source mixing.
      return;
    }
    const sourcePath = source.name;
    const sourceLeaf = getFolderLeafName(sourcePath);
    const targetPath = targetFolderId ? folders.find((folder) => folder.id === targetFolderId)?.name ?? '' : '';
    if (isDescendantPath(targetPath, sourcePath)) return;
    const nextPath = targetPath ? `${targetPath}/${sourceLeaf}` : sourceLeaf;
    onRenameFolder(folderId, nextPath);
  }, [folders, onRenameFolder, resolveFolderSource]);

  const handleDropItem = useCallback((targetFolderId: string | null, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const item = parseDraggedItem(e);
    setDraggedItem(null);
    setDropTargetId(null);
    setDropPosition(null);
    if (!item) return;

    if (item.kind === 'note') {
      const note = notes.find((n) => n.id === item.id);
      if (!note) return;
      const noteSource = resolveNoteSource(note);
      if (targetFolderId) {
        const target = folders.find((folder) => folder.id === targetFolderId);
        if (!target) return;
        if (resolveFolderSource(target) !== noteSource) return;
      } else if (noteSource !== 'noa') {
        return;
      }
      onMoveNote(item.id, targetFolderId ?? '');
      return;
    }

    if (item.kind === 'folder') {
      moveFolderToTarget(item.id, targetFolderId);
    }
  }, [folders, moveFolderToTarget, notes, onMoveNote, parseDraggedItem, resolveFolderSource, resolveNoteSource]);

  const handleDragStartItem = useCallback((kind: 'note' | 'folder', id: string, name: string) => (e: React.DragEvent) => {
    const payload = { kind, id, name };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-noa-tree-item', JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    setDraggedItem(payload);
  }, []);

  const handleDragEndItem = useCallback(() => {
    setDraggedItem(null);
    setDropTargetId(null);
    setDropPosition(null);
  }, []);

  const handleDragOverTarget = useCallback((targetId: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;
    setDropTargetId(targetId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isUpperHalf = e.clientY < rect.top + rect.height / 2;
    setDropPosition(isUpperHalf ? 'top' : 'bottom');
    e.dataTransfer.dropEffect = 'move';
  }, [draggedItem]);

  const handleDragEnterTarget = useCallback((targetId: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;
    setDropTargetId(targetId);
  }, [draggedItem]);

  const renderFolderNode = useCallback((node: FolderTreeNode, depth: number, activeId: string, parentPath: string = '') => {
    const leafName = getFolderLeafName(node.folder.name);
    const folderSource = resolveFolderSource(node.folder);
    const canCreateInsideFolder = folderSource === 'noa';
    const childNotes = notesByFolderId.get(node.folder.id) || [];
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
          {!hasChildren && <div className="text-[#2D2D2D]/50 px-6 py-1 font-redaction text-sm" style={{ paddingLeft: `2px` }}>Empty</div>}
        </FileNode>
      </div>
    );
  }, [dropPosition, dropTargetId, folderTreeResetKey, foldersExpandedByDefault, handleDragEndItem, handleDragEnterTarget, handleDragOverTarget, handleDragStartItem, handleDropItem, notesByFolderId, onCreateFolder, onCreateNote, onDeleteFolder, onRenameNote, onSelectNote, renameFolderWithValidation, resolveFolderSource, selectedNoteIds, templateMenuFolderId]);

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

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rebuild index when notes/settings change (debounced). Does not execute search —
  // the query effect below handles that after each index rebuild too.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      if (!searchEngineRef.current) {
        searchEngineRef.current = new SearchEngine(notes, caseSensitive, fuzzySearch);
      } else {
        searchEngineRef.current.updateNotes(notes, caseSensitive, fuzzySearch);
      }
      // Re-run search after index rebuild so results reflect updated notes.
      if (searchEngineRef.current && deferredSearchQuery) {
        setSearchResults(searchEngineRef.current.search(deferredSearchQuery, caseSensitive));
      }
    }, 250);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [notes, caseSensitive, fuzzySearch]); // intentionally excludes deferredSearchQuery

  // Query/search execution uses deferred input to keep typing responsive.
  useEffect(() => {
    if (!searchEngineRef.current) return;
    setSearchResults(searchEngineRef.current.search(deferredSearchQuery, caseSensitive));
  }, [deferredSearchQuery, caseSensitive]);

  const [isDragOver, setIsDragOver] = useState(false);
  const { size: tagsHeight, setIsDragging } = useResizeDrag(
    250, 100, window.innerHeight * 0.8,
    (e: MouseEvent) => window.innerHeight - e.clientY,
    'row-resize'
  );

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

  const allTags = useMemo(() => {
    const tagCounts: Record<string, number> = {};
    notes.forEach(note => {
      note.tags?.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    return Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  }, [notes]);

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
        <div className="border-b-2 border-[#B89B5E] bg-[#B89B5E]/10 px-3 py-2 flex flex-col gap-1.5 font-redaction shrink-0 z-10">
          <p className="text-xs text-[#2D2D2D]">
            Delete "<span className="font-bold">{pendingDelete.name}</span>"?{' '}
            {pendingDelete.type === 'folder'
              ? (() => {
                  const target = folders.find((folder) => folder.id === pendingDelete.id);
                  const count = target ? getFolderSubtreeNoteCount(target.name) : notes.filter(n => n.folder === pendingDelete.id).length;
                  return count > 0
                    ? `This folder and its subfolders contain ${count} note${count !== 1 ? 's' : ''}. All notes will be permanently deleted.`
                    : 'This cannot be undone.';
                })()
              : 'This cannot be undone.'}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => { pendingDelete.type === 'note' ? onDeleteNote(pendingDelete.id) : onDeleteFolder(pendingDelete.id); setPendingDelete(null); }}
              className="px-2 py-0.5 text-xs font-bold bg-red-500 text-white border border-[#2D2D2D] hover:opacity-90"
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
                      <span dangerouslySetInnerHTML={{ __html: sanitizeHighlightHtml(result.titleSnippet) || 'Untitled' }} className="truncate" />
                    </div>
                    <div 
                      className="text-xs text-[#2D2D2D]/70 font-redaction leading-relaxed break-words line-clamp-2"
                      dangerouslySetInnerHTML={{ __html: sanitizeHighlightHtml(result.contentSnippet) }}
                    />
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
              {recentNoteIds.length > 0 && (
                <div className="border-b border-[#2D2D2D]/20 mb-1">
                  <button
                    className="w-full flex items-center px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#2D2D2D]/60 hover:text-[#2D2D2D] transition-colors"
                    onClick={() => setIsRecentOpen(v => !v)}
                  >
                    {isRecentOpen ? <ChevronDown size={12} className="mr-1.5 shrink-0" /> : <ChevronRight size={12} className="mr-1.5 shrink-0" />}
                    Recent Notes
                  </button>
                  {isRecentOpen && (
                    <div className="pb-1">
                      {recentNoteIds.slice(0, 5).map(id => {
                        const note = notes.find(n => n.id === id);
                        if (!note) return null;
                        return (
                          <div
                            key={id}
                            className={`flex items-center px-3 py-1 cursor-pointer text-sm truncate ${activeNoteId === id ? 'bg-[#EAE8E0] font-bold text-[#B89B5E]' : 'hover:bg-[#DCD9CE]/50 text-[#2D2D2D]'}`}
                            onClick={() => onSelectNote(id)}
                          >
                            <FileText size={13} className={`mr-2 shrink-0 ${activeNoteId === id ? 'text-[#B89B5E]' : 'text-[#2D2D2D]/50'}`} />
                            <span className="truncate font-redaction">{note.title || 'Untitled'}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <div data-testid="sidebar-file-tree">
                <FileNode
                  name="workspace"
                  isFolder
                  defaultOpen
                  icon={Folder}
                  onAdd={() => onCreateFolder()}
                  onDragEnter={handleDragEnterTarget(ROOT_DROP_TARGET_ID)}
                  onDragOver={handleDragOverTarget(ROOT_DROP_TARGET_ID)}
                  onDrop={(e) => handleDropItem(null, e)}
                  onDragEnd={handleDragEndItem}
                  isDropTarget={dropTargetId === ROOT_DROP_TARGET_ID}
                  dropPosition={dropTargetId === ROOT_DROP_TARGET_ID ? dropPosition : null}
                  depth={0}
                >
                  <FileNode
                    name="Noa"
                    isFolder
                    defaultOpen
                    icon={Folder}
                    onAdd={() => onCreateFolder()}
                    onDragEnter={handleDragEnterTarget(NOA_ROOT_DROP_TARGET_ID)}
                    onDragOver={handleDragOverTarget(NOA_ROOT_DROP_TARGET_ID)}
                    onDrop={(e) => handleDropItem(null, e)}
                    onDragEnd={handleDragEndItem}
                    isDropTarget={dropTargetId === NOA_ROOT_DROP_TARGET_ID}
                    dropPosition={dropTargetId === NOA_ROOT_DROP_TARGET_ID ? dropPosition : null}
                    depth={1}
                  >
                    {noaFolderTree.map((node) => renderFolderNode(node, 2, activeNoteId))}
                    {(notesByFolderId.get('') || []).filter((note) => resolveNoteSource(note) === 'noa').map((note) => (
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
                        depth={2}
                      />
                    ))}
                    {noaFolderTree.length === 0 && (notesByFolderId.get('') || []).filter((note) => resolveNoteSource(note) === 'noa').length === 0 && (
                      <div className="text-[#2D2D2D]/50 px-6 py-1 font-redaction text-sm" style={{ paddingLeft: '20px' }}>Empty</div>
                    )}
                  </FileNode>
                  <FileNode
                    name="Obsidian Vault"
                    isFolder
                    defaultOpen
                    icon={Folder}
                    onDragEnter={handleDragEnterTarget(IMPORT_ROOT_DROP_TARGET_ID)}
                    onDragOver={handleDragOverTarget(IMPORT_ROOT_DROP_TARGET_ID)}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDraggedItem(null);
                      setDropTargetId(null);
                      setDropPosition(null);
                    }}
                    onDragEnd={handleDragEndItem}
                    isDropTarget={dropTargetId === IMPORT_ROOT_DROP_TARGET_ID}
                    dropPosition={dropTargetId === IMPORT_ROOT_DROP_TARGET_ID ? dropPosition : null}
                    depth={1}
                  >
                    {importedFolderTree.map((node) => renderFolderNode(node, 2, activeNoteId))}
                    {(notesByFolderId.get('') || []).filter((note) => resolveNoteSource(note) === 'obsidian-import').map((note) => (
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
                        depth={2}
                      />
                    ))}
                    {importedFolderTree.length === 0 && (notesByFolderId.get('') || []).filter((note) => resolveNoteSource(note) === 'obsidian-import').length === 0 && (
                      <div className="text-[#2D2D2D]/50 px-6 py-1 font-redaction text-sm" style={{ paddingLeft: '20px' }}>Empty</div>
                    )}
                  </FileNode>
                </FileNode>
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

      {/* Tags Explorer Section replacing Activity Log */}
      <div
        className="flex shrink-0 border-t border-[#2D2D2D] relative flex-col bg-[#DCD9CE]/30"
        style={{ height: tagsHeight }}
      >
        <div 
          className="h-3 w-full bg-transparent hover:bg-[#B89B5E]/20 cursor-row-resize absolute top-0 left-0 right-0 z-20 -translate-y-1/2 transition-colors"
          onMouseDown={() => setIsDragging(true)}
        />
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#2D2D2D]/70 border-b border-[#2D2D2D]/20 flex items-center shrink-0">
          <Hash size={12} className="mr-1" />
          Tags Explorer
        </div>
        <div className="flex-1 overflow-y-auto p-3 flex flex-wrap gap-2 content-start">
          {allTags.length === 0 ? (
            <div className="text-xs text-[#2D2D2D]/50 p-1 font-redaction">No tags found in notes</div>
          ) : (
            allTags.map(([tag, count]) => (
              <button
                key={tag}
                onClick={() => onSearchTag && onSearchTag(tag)}
                className="text-xs font-redaction text-[#2D2D2D] bg-[#EAE8E0] border border-[#2D2D2D]/20 px-2 py-1 hover:border-[#B89B5E] hover:text-[#B89B5E] active:opacity-70 transition-colors flex items-center"
              >
                <span className="opacity-50 mr-0.5">#</span>
                {tag}
                <span className="ml-1.5 opacity-50 text-[10px] bg-[#2D2D2D]/5 px-1">{count}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
