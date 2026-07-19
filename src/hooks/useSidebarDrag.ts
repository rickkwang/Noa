import { useState, useCallback } from 'react';
import { getFolderLeafName, isDescendantPath } from '../lib/pathUtils';
import { Note, Folder } from '../types';

interface UseSidebarDragOptions {
  notes: Note[];
  folders: Folder[];
  onMoveNote: (id: string, folderId: string) => void;
  onRenameFolder: (id: string, newName: string) => void;
}

export function useSidebarDrag({
  notes,
  folders,
  onMoveNote,
  onRenameFolder,
}: UseSidebarDragOptions) {
  const [draggedItem, setDraggedItem] = useState<{ kind: 'note' | 'folder'; id: string; name: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const isVaultNote = useCallback((note: Note) => note.origin === 'vault', []);
  const isVaultFolder = useCallback((folder: Folder) => folder.origin === 'vault', []);

  const parseDraggedItem = useCallback((e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-noa-tree-item') || e.dataTransfer.getData('text/plain');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        (parsed.kind === 'note' || parsed.kind === 'folder') &&
        typeof parsed.id === 'string' &&
        typeof parsed.name === 'string'
      ) {
        return parsed as { kind: 'note' | 'folder'; id: string; name: string };
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const moveFolderToTarget = useCallback((
    folderId: string,
    targetFolderId: string | null,
    rootIsVault: boolean,
  ) => {
    const source = folders.find((f) => f.id === folderId);
    if (!source) return;
    const sourceIsVault = isVaultFolder(source);
    if (targetFolderId) {
      const target = folders.find((f) => f.id === targetFolderId);
      if (!target || isVaultFolder(target) !== sourceIsVault) return;
    } else if (sourceIsVault !== rootIsVault) {
      return;
    }
    const sourcePath = source.name;
    const sourceLeaf = getFolderLeafName(sourcePath);
    const targetPath = targetFolderId ? (folders.find((f) => f.id === targetFolderId)?.name ?? '') : '';
    if (isDescendantPath(targetPath, sourcePath)) return;
    const nextPath = targetPath ? `${targetPath}/${sourceLeaf}` : sourceLeaf;
    onRenameFolder(folderId, nextPath);
  }, [folders, isVaultFolder, onRenameFolder]);

  const handleDropItem = useCallback((
    targetFolderId: string | null,
    e: React.DragEvent,
    rootIsVault = false,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const item = parseDraggedItem(e);
    setDraggedItem(null);
    setDropTargetId(null);
    if (!item) return;

    if (item.kind === 'note') {
      const note = notes.find((n) => n.id === item.id);
      if (!note) return;
      const noteIsVault = isVaultNote(note);
      if (targetFolderId) {
        const target = folders.find((f) => f.id === targetFolderId);
        if (!target || isVaultFolder(target) !== noteIsVault) return;
      } else if (noteIsVault !== rootIsVault) {
        return;
      }
      onMoveNote(item.id, targetFolderId ?? '');
      return;
    }

    if (item.kind === 'folder') {
      moveFolderToTarget(item.id, targetFolderId, rootIsVault);
    }
  }, [folders, isVaultFolder, isVaultNote, moveFolderToTarget, notes, onMoveNote, parseDraggedItem]);

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
  }, []);

  const handleDragOverTarget = useCallback((targetId: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;
    setDropTargetId(targetId);
    e.dataTransfer.dropEffect = 'move';
  }, [draggedItem]);

  const handleDragEnterTarget = useCallback((targetId: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;
    setDropTargetId(targetId);
  }, [draggedItem]);

  return {
    dropTargetId,
    handleDropItem,
    handleDragStartItem,
    handleDragEndItem,
    handleDragOverTarget,
    handleDragEnterTarget,
  };
}
