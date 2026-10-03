import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getFolderParentPath } from '../../lib/pathUtils';
import { Folder as FolderType } from '../../types';
import { ChevronRight, FileText, Plus, Trash2, Folder, FolderOpen, FolderPlus } from '@/src/lib/icons';

export interface FileNodeProps {
  name: string;
  isFolder?: boolean;
  showFolderChevron?: boolean;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  isActive?: boolean;
  isSelected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDelete?: () => void;
  onRename?: (newName: string) => string | void;
  icon?: React.ElementType;
  onAdd?: () => void;
  onAddFolder?: () => void;
  onNewNote?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isDropTarget?: boolean;
  isDragging?: boolean;
  addButtonProps?: Record<string, unknown>;
  depth?: number;
}

export interface FolderTreeNode {
  folder: FolderType;
  children: FolderTreeNode[];
}

export function buildFolderTree(folders: FolderType[]): FolderTreeNode[] {
  const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name));
  const seenNames = new Set<string>();
  const unique = sorted.filter((f) => {
    if (seenNames.has(f.name)) return false;
    seenNames.add(f.name);
    return true;
  });
  const nodeByPath = new Map<string, FolderTreeNode>();
  const roots: FolderTreeNode[] = [];

  for (const folder of unique) {
    const node: FolderTreeNode = { folder, children: [] };
    nodeByPath.set(folder.name, node);
  }

  for (const folder of unique) {
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

export const FileNode = React.memo(({
  name, isFolder, children, defaultOpen = false, showFolderChevron = false, isActive, isSelected,
  onClick, onDelete, onRename, icon: Icon = FileText,
  onAdd, onAddFolder, onNewNote, draggable, onDragStart, onDragEnter, onDragOver,
  onDrop, onDragEnd, isDropTarget, isDragging, addButtonProps = {}, depth = 0,
}: FileNodeProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuItemClass = 'noa-sidebar-hover-surface flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] text-[#2D2D2B]';

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen]);

  useEffect(() => {
    if (!menuPosition) return;
    menuRef.current?.querySelector('button')?.focus();
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuPosition(null);
    };
    const closeOnScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuPosition(null);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [menuPosition]);

  const openContextMenu = (x: number, y: number) => {
    if (!onRename && !onDelete && !onNewNote && !onAddFolder) return;
    const itemCount = Number(!!onNewNote) + Number(!!onAddFolder) + Number(!!onRename) + Number(!!onDelete);
    const menuHeight = 8 + itemCount * 28 + (onNewNote || onAddFolder ? 9 : 0);
    setMenuPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - 184)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    });
  };

  const startRename = () => {
    setMenuPosition(null);
    setIsEditing(true);
    setEditName(name);
    setRenameError(null);
  };

  const handleRenameSubmit = () => {
    const nextName = editName.trim();
    if (!nextName) {
      setRenameError('Name cannot be empty.');
      return;
    }
    if (nextName !== name) {
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
      setEditName(name);
      setRenameError(null);
    }
  };

  return (
    /* Drop handlers sit on the whole node — title plus subtree — not on the
       title row, so that dragging over a note inside a folder resolves to that
       folder rather than bubbling past it to the root. Obsidian binds its drop
       target to `.nav-folder` for exactly this reason; the handlers stop
       propagation, so the innermost folder under the cursor wins. */
    <div
      className={`font-redaction mb-px noa-sidebar-tree-item ${isFolder && isDropTarget ? 'noa-sidebar-drop-branch' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        ref={rowRef}
        /* While dragging, the row carries ONLY the dragging fill: emitting the
           hover class too would hand the background to the hover wash, whose
           `!important` out-specifies the fill (and Chromium freezes :hover at
           dragstart, so it never comes back mid-drag). */
        className={`flex items-center justify-between py-1 px-2 mx-1.5 rounded-lg cursor-pointer select-none group ${
          isDragging
            ? 'noa-sidebar-row-dragging'
            : isDropTarget
              ? 'noa-sidebar-drop-row'
              : isSelected
                ? 'bg-[#CC7D5E]/20 shadow-[inset_2px_0_0_#CC7D5E]'
                : (isActive ? 'noa-sidebar-active-surface' : 'noa-sidebar-hover-surface-subtle')
        }`}
        style={{
          paddingLeft: `${depth === 0 ? 7 : 2}px`,
        }}
        draggable={draggable}
        tabIndex={0}
        aria-haspopup="menu"
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          if (isFolder) setIsOpen(!isOpen);
          if (onClick) onClick(e);
        }}
        onDoubleClick={onRename ? (e) => { e.stopPropagation(); startRename(); } : undefined}
        onContextMenu={(e) => {
          if (isEditing) return;
          e.preventDefault();
          e.stopPropagation();
          openContextMenu(e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          if (isEditing || (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10'))) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          openContextMenu(rect.left + 16, rect.bottom);
        }}
      >
        <div className="flex items-center overflow-hidden flex-1">
          {isFolder && showFolderChevron && (
            <span className="w-4 flex justify-center mr-1 shrink-0">
              <ChevronRight size={14} style={{ transition: 'transform 200ms ease-in-out', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
            </span>
          )}
          {/* The active accent would fight the solid fill the dragged row
              carries, so the icon just inherits while dragging. */}
          <span className={`mr-2 shrink-0 ${isActive && !isDragging ? 'text-[#CC7D5E]' : ''}`}>
            {(() => {
              const RenderIcon = isFolder ? (isOpen ? FolderOpen : Folder) : Icon;
              return <RenderIcon size={14} weight="regular" />;
            })()}
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
              className="bg-transparent border-b border-[#2D2D2B] outline-none w-full text-[#2D2D2B] font-redaction"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className={`truncate ${isActive ? 'font-bold' : ''}`}>
              {name}
            </span>
          )}
        </div>
        <div className="noa-sidebar-row-actions flex items-center opacity-0 group-hover:opacity-100 shrink-0 ml-2">
          {isFolder && onAddFolder && (
            <button
              onClick={(e) => { e.stopPropagation(); onAddFolder(); }}
              className="hover:text-[#CC7D5E] p-1"
              title="Add subfolder"
            >
              <FolderPlus size={14} />
            </button>
          )}
          {isFolder && onAdd && (
            <button
              {...addButtonProps}
              onClick={(e) => { e.stopPropagation(); onAdd(); }}
              className="hover:text-[#CC7D5E] p-1"
              title="Add"
            >
              <Plus size={14} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="hover:text-[#D45555] p-1"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {menuPosition && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${name} actions`}
          className="fixed z-[90] w-44 max-h-[calc(100vh-16px)] overflow-y-auto rounded-[10px] border border-[var(--divider-subtle)] bg-[#F9F9F7] p-1 font-redaction noa-floating-panel"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setMenuPosition(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setMenuPosition(null);
              rowRef.current?.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              items[(index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            }
          }}
        >
          {onNewNote && <button role="menuitem" className={menuItemClass} onClick={() => { setMenuPosition(null); onNewNote(); }}>New note</button>}
          {onAddFolder && <button role="menuitem" className={menuItemClass} onClick={() => { setMenuPosition(null); onAddFolder(); }}>New folder</button>}
          {(onNewNote || onAddFolder) && <div className="mx-1 my-1 h-px bg-[var(--divider-subtle)]" />}
          {onRename && <button role="menuitem" className={menuItemClass} onClick={startRename}>Rename…</button>}
          {onDelete && <button role="menuitem" className={menuItemClass} onClick={() => { setMenuPosition(null); onDelete(); }}>Delete</button>}
        </div>,
        document.body,
      )}
      {isEditing && renameError && (
        <div className="px-2 pt-1 text-[10px] text-[#C24444] font-redaction leading-snug">
          {renameError}
        </div>
      )}
      {isFolder && children && (
        <div
          className="transition-[grid-template-rows] duration-200 ease-in-out"
          style={{
            display: 'grid',
            gridTemplateRows: isOpen ? '1fr' : '0fr',
            // Anchor the child branch to this row's 14px icon center: 6px row
            // margin + (7px root / 2px child padding) + 7px half-icon, minus
            // the border's own half-pixel so the line's center lands on it.
            marginLeft: depth === 0 ? '19.5px' : '14.5px',
          }}
        >
          <div className="overflow-hidden border-l border-[var(--divider-subtle)]">
            {children}
          </div>
        </div>
      )}
    </div>
  );
});
