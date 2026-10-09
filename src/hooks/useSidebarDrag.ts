import { useState, useCallback, useEffect } from 'react';
import { getFolderLeafName } from '../lib/pathUtils';
import { setTreeItemDragImage } from '../lib/treeDragImage';
import { resolveTreeDrop, TreeDragItem } from '../lib/treeDropTarget';
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
  const [draggedItem, setDraggedItem] = useState<TreeDragItem | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

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
        return parsed as TreeDragItem;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const resolveDrop = useCallback((
    item: TreeDragItem,
    targetFolderId: string | null,
    rootIsVault: boolean,
  ) => resolveTreeDrop(item, targetFolderId, rootIsVault, notes, folders), [folders, notes]);

  const handleDropItem = useCallback((
    targetFolderId: string | null,
    e: React.DragEvent,
    rootIsVault = false,
  ) => {
    // Claim the event only when it carries a tree item; otherwise OS file drops can't reach Sidebar's import onDrop.
    const item = parseDraggedItem(e);
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggedItem(null);
    setDropTargetId(null);

    const move = resolveDrop(item, targetFolderId, rootIsVault);
    if (move.kind === 'note') onMoveNote(move.noteId, move.folderId);
    else if (move.kind === 'folder') onRenameFolder(move.folderId, move.nextPath);
  }, [onMoveNote, onRenameFolder, parseDraggedItem, resolveDrop]);

  const handleDragStartItem = useCallback((kind: 'note' | 'folder', id: string, name: string) => (e: React.DragEvent) => {
    const payload = { kind, id, name };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-noa-tree-item', JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    // Match the row's own label: notes render with the .md suffix, folders
    // render their leaf rather than the stored path.
    setTreeItemDragImage(e, kind, kind === 'note' ? `${name}.md` : getFolderLeafName(name));
    setDraggedItem(payload);
  }, []);

  const handleDragEndItem = useCallback(() => {
    setDraggedItem(null);
    setDropTargetId(null);
  }, []);

  // `highlightId` is what the tree paints; `targetFolderId` is where the drop
  // would land — they differ for the two root regions, which share the null
  // folder and are told apart by `rootIsVault`.
  const markTarget = useCallback((
    highlightId: string,
    targetFolderId: string | null,
    rootIsVault: boolean,
    e: React.DragEvent,
  ) => {
    // Same as the drop handler: an OS file drag must reach Sidebar's dragover to raise the import overlay.
    if (!draggedItem) return;
    e.preventDefault();
    e.stopPropagation();
    if (resolveDrop(draggedItem, targetFolderId, rootIsVault).kind === 'none') {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(highlightId);
  }, [draggedItem, resolveDrop]);

  // One handler for dragenter and dragover: enter lands the first frame without waiting for movement.
  const handleDragTarget = useCallback((
    highlightId: string,
    targetFolderId: string | null,
    rootIsVault = false,
  ) => (e: React.DragEvent) => markTarget(highlightId, targetFolderId, rootIsVault, e), [markTarget]);

  // No dragleave on rows (avoids strobing): a capture-phase dragover on window clears hover, and the real
  // target re-asserts it as the event bubbles; both updates batch into one render.
  useEffect(() => {
    if (!draggedItem) return;
    const clear = () => setDropTargetId(null);
    window.addEventListener('dragover', clear, { capture: true });
    return () => window.removeEventListener('dragover', clear, { capture: true });
  }, [draggedItem]);

  return {
    draggingId: draggedItem?.id ?? null,
    dropTargetId,
    handleDropItem,
    handleDragStartItem,
    handleDragEndItem,
    handleDragTarget,
  };
}
