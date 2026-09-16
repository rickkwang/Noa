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

/* What a drop would do. One predicate serves both the hover and the drop:
   Obsidian runs its equivalent (`zj`) on dragover as well, so a target that
   would be refused never lights up — the highlight cannot promise a move the
   drop then silently declines.

   `none` and `noop` are both write-free, but they mean different things.
   `none` is *illegal* — cross-ownership, a folder into its own descendant —
   and the hover refuses it (forbidden cursor, no highlight). `noop` is
   *already there* — the item lives exactly where this drop would put it. That
   landing is safe, so the hover still welcomes it; only the write is skipped,
   which is what saves a pointless rename and vault write. */
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
  // Equal paths count as descendant, so this rejects a folder dropped on
  // itself as well as on anything beneath it.
  if (isDescendantPath(targetPath, source.name)) return NONE;
  const leaf = getFolderLeafName(source.name);
  const nextPath = targetPath ? `${targetPath}/${leaf}` : leaf;
  if (nextPath === source.name) return NOOP;
  // Same rule the rename dialog enforces (Sidebar's `renameFolderWithValidation`):
  // a folder may not land beside a sibling of the same name. Without it the drop
  // writes a second folder onto an occupied path — and because this predicate also
  // drives the hover, the target would have lit up promising exactly that move.
  const leafKey = leaf.toLocaleLowerCase();
  const occupied = folders.some((f) =>
    f.id !== source.id &&
    isVault(f) === isVault(source) &&
    getFolderParentPath(f.name) === targetPath &&
    getFolderLeafName(f.name).toLocaleLowerCase() === leafKey
  );
  return occupied ? NONE : { kind: 'folder', folderId: source.id, nextPath };
}
