import { Folder, Note } from '../types';
import { getFolderLeafName, getFolderParentPath, isDescendantPath } from './pathUtils';

export type TreeDragItem = { kind: 'note' | 'folder'; id: string; name: string };

export type TreeDropResolution =
  | { kind: 'none' }
  | { kind: 'noop' }
  | { kind: 'note'; noteId: string; folderId: string }
  | { kind: 'folder'; folderId: string; nextPath: string };

const NONE: TreeDropResolution = { kind: 'none' };
const NOOP: TreeDropResolution = { kind: 'noop' };

/* What a drop would do. One predicate serves both hover and drop, so a target
   that would be refused never highlights.

   `none` is illegal (cross-ownership, folder into its own descendant): hover
   refuses it. `noop` is already in place: hover welcomes it, but the write is
   skipped. */
export function resolveTreeDrop(
  item: TreeDragItem,
  targetFolderId: string | null,
  rootIsVault: boolean,
  notes: Note[],
  folders: Folder[],
): TreeDropResolution {
  const isVault = (entity: { origin?: string }) => entity.origin === 'vault';

  if (item.kind === 'note') {
    const note = notes.find((n) => n.id === item.id);
    if (!note) return NONE;
    if (targetFolderId) {
      const target = folders.find((f) => f.id === targetFolderId);
      if (!target || isVault(target) !== isVault(note)) return NONE;
    } else if (isVault(note) !== rootIsVault) {
      return NONE;
    }
    const folderId = targetFolderId ?? '';
    return (note.folder || '') === folderId ? NOOP : { kind: 'note', noteId: note.id, folderId };
  }

  const source = folders.find((f) => f.id === item.id);
  if (!source || source.id === targetFolderId) return NONE;
  let targetPath = '';
  if (targetFolderId) {
    const target = folders.find((f) => f.id === targetFolderId);
    if (!target || isVault(target) !== isVault(source)) return NONE;
    targetPath = target.name;
  } else if (isVault(source) !== rootIsVault) {
    return NONE;
  }
  // Equal paths count as descendant: rejects dropping a folder onto itself too.
  if (isDescendantPath(targetPath, source.name)) return NONE;
  const leaf = getFolderLeafName(source.name);
  const nextPath = targetPath ? `${targetPath}/${leaf}` : leaf;
  if (nextPath === source.name) return NOOP;
  // Same sibling-name rule as the rename dialog (Sidebar's `renameFolderWithValidation`).
  // This predicate also drives hover, so the target must not light up for an occupied path.
  const leafKey = leaf.toLocaleLowerCase();
  const occupied = folders.some((f) =>
    f.id !== source.id &&
    isVault(f) === isVault(source) &&
    getFolderParentPath(f.name) === targetPath &&
    getFolderLeafName(f.name).toLocaleLowerCase() === leafKey
  );
  return occupied ? NONE : { kind: 'folder', folderId: source.id, nextPath };
}
