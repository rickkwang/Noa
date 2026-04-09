import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, FileText, Plus, Trash2, Folder, FolderPlus } from 'lucide-react';
import { Folder as FolderType } from '../../types';
import { getFolderParentPath } from '../../lib/pathUtils';

export interface FileNodeProps {
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
  name, isFolder, children, defaultOpen = false, isActive, isSelected,
  onClick, onDelete, onRename, icon: Icon = FileText, iconColor,
  onAdd, onAddFolder, draggable, onDragStart, onDragEnter, onDragOver,
  onDrop, onDragEnd, isDropTarget, dropPosition, addButtonProps = {}, depth = 0,
}: FileNodeProps) => {
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
          className="transition-[grid-template-rows] duration-200 ease-in-out"
          style={{ display: 'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', marginLeft: '18px' }}
        >
          <div className="overflow-hidden border-l border-[#2D2D2D]/15">
            {children}
          </div>
        </div>
      )}
    </div>
  );
});
