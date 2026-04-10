import { useState, useCallback } from 'react';
import { Note, Folder } from '../types';
import { getFolderLeafName, isDescendantPath } from '../lib/pathUtils';

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
  const [dropPosition, setDropPosition] = useState<'top' | 'bottom' | null>(null);

  const resolveNoteSource = useCallback((note: Note) => note.source ?? 'noa', []);
  const resolveFolderSource = useCallback((folder: Folder) => folder.source ?? 'noa', []);

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

  const moveFolderToTarget = useCallback((folderId: string, targetFolderId: string | null) => {
    const source = folders.find((f) => f.id === folderId);
    if (!source) return;
    const sourceType = resolveFolderSource(source);
    if (targetFolderId) {
      const target = folders.find((f) => f.id === targetFolderId);
      if (!target || resolveFolderSource(target) !== sourceType) return;
    } else if (sourceType !== 'noa') {
      return;
    }
    const sourcePath = source.name;
    const sourceLeaf = getFolderLeafName(sourcePath);
    const targetPath = targetFolderId ? (folders.find((f) => f.id === targetFolderId)?.name ?? '') : '';
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
        const target = folders.find((f) => f.id === targetFolderId);
        if (!target || resolveFolderSource(target) !== noteSource) return;
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
    setDropPosition(e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom');
    e.dataTransfer.dropEffect = 'move';
  }, [draggedItem]);

  const handleDragEnterTarget = useCallback((targetId: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;
    setDropTargetId(targetId);
  }, [draggedItem]);

  return {
    draggedItem,
    dropTargetId,
    dropPosition,
    handleDropItem,
    handleDragStartItem,
    handleDragEndItem,
    handleDragOverTarget,
    handleDragEnterTarget,
  };
}
