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
    // Claim the event only once we know it carries a tree item. These handlers
    // blanket the whole tree, so swallowing first would leave files dragged in
    // from the OS with nowhere to land: Sidebar's import `onDrop` sits on the
    // sidebar root and only ever sees what bubbles past here.
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
    // Same reason as the drop handler: with no tree drag in flight this is an
    // OS file drag passing through, and it has to reach the sidebar's own
    // dragover to raise the import overlay. Claiming it here would blank the
    // overlay across the entire tree.
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

  // One handler for both dragenter and dragover: enter only makes the first
  // frame land without waiting for pointer movement, and dragover re-asserts
  // the target on every tick against the reset below.
  const handleDragTarget = useCallback((
    highlightId: string,
    targetFolderId: string | null,
    rootIsVault = false,
  ) => (e: React.DragEvent) => markTarget(highlightId, targetFolderId, rootIsVault, e), [markTarget]);

  // Obsidian never listens for dragleave on rows: it clears the hover in a
  // capture-phase dragover on the *window* and lets the real target re-assert
  // itself as that same event bubbles. Both updates are batched into one
  // render, so nothing repaints in between and the highlight cannot strobe as
  // the cursor crosses rows — and dragging out of the tree entirely leaves
  // nothing lit, with no enter/leave pairs to reason about.
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
