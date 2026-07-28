import type { Folder, Note, VaultPendingOperation } from '../types';
import { isDescendantPath } from './pathUtils';

/**
 * Build the folder list after renaming `folderId` to `nextName`: the target
 * plus every same-domain descendant path gets the prefix swapped. Descendants
 * across the vault/noa boundary never share on-disk paths, so they are left
 * untouched even when names collide.
 */
export function buildRenamedFolderList(
  folders: readonly Folder[],
  folderId: string,
  previousName: string,
  nextName: string,
  targetIsVault: boolean,
): Folder[] {
  return folders.map((folder) => {
    if (folder.id === folderId) return { ...folder, name: nextName };
    if ((folder.origin === 'vault') === targetIsVault && isDescendantPath(folder.name, previousName)) {
      return { ...folder, name: nextName + folder.name.slice(previousName.length) };
    }
    return folder;
  });
}

/**
 * Every folder removed by deleting `folderId`: the target plus same-domain
 * descendants. Same boundary rule as rename — a Noa folder name can match a
 * vault directory by coincidence and must not be swept up.
 */
export function computeFolderIdsToDelete(folders: readonly Folder[], folderId: string): Set<string> {
  const target = folders.find((folder) => folder.id === folderId);
  const targetIsVault = target?.origin === 'vault';
  const prefix = target?.name ?? '';
  return new Set(
    folders
      .filter((folder) =>
        folder.id === folderId
        || ((folder.origin === 'vault') === targetIsVault
          && folder.name.startsWith(`${prefix}/`)))
      .map((folder) => folder.id),
  );
}

/** Prepared delete-note operations for every vault note inside `folderIds`. */
export function buildVaultNoteDeleteOperations(
  notes: readonly Note[],
  vaultFolders: Folder[],
  folderIds: ReadonlySet<string>,
): Map<string, VaultPendingOperation> {
  return new Map(
    notes
      .filter((note) => note.origin === 'vault' && folderIds.has(note.folder))
      .map((note) => {
        const entityKey = `note:${note.id}`;
        return [note.id, {
          key: `${entityKey}:delete:${crypto.randomUUID()}`,
          entityKey,
          kind: 'delete-note',
          phase: 'prepared',
          note,
          folders: vaultFolders,
        } satisfies VaultPendingOperation] as const;
      }),
  );
}

/**
 * Split candidate note operations after the local delete resolves: operations
 * for notes that actually got deleted are handed off to the sync layer; the
 * rest must be cancelled so they don't linger as unclaimed reservations.
 */
export function partitionFolderDeleteOutcomes(
  candidateNotes: readonly Note[],
  noteOperations: ReadonlyMap<string, VaultPendingOperation>,
  deletedNoteIds: ReadonlySet<string>,
): { handoff: Array<{ note: Note; operation: VaultPendingOperation }>; cancel: VaultPendingOperation[] } {
  const handoff: Array<{ note: Note; operation: VaultPendingOperation }> = [];
  const cancel: VaultPendingOperation[] = [];
  for (const note of candidateNotes) {
    const operation = noteOperations.get(note.id);
    if (!operation) continue;
    if (deletedNoteIds.has(note.id)) handoff.push({ note, operation });
    else cancel.push(operation);
  }
  return { handoff, cancel };
}

/**
 * On the error path, prepared operations that were never handed to the sync
 * layer must be cancelled; anything already handed off owns its own cleanup.
 */
export function selectUnclaimedOperations(
  preparedOperations: readonly VaultPendingOperation[],
  handedOffOperationKeys: ReadonlySet<string>,
): VaultPendingOperation[] {
  return preparedOperations.filter((operation) => !handedOffOperationKeys.has(operation.key));
}
