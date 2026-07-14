import type { Folder, Note, VaultPendingOperation } from '../types';

/** Scope durable operations to the selected vault before any replay occurs. */
export function selectVaultPendingOperations(
  operations: readonly VaultPendingOperation[],
  vaultId: string,
): VaultPendingOperation[] {
  return operations.filter((operation) => operation.vaultId === vaultId);
}

/**
 * A prepared journal row proves intent, but not that the local mutation landed.
 * On recovery, use the persisted local workspace as the commit record: replay
 * only when it already reflects the requested destructive change.
 */
export function shouldReplayVaultPendingOperation(
  operation: VaultPendingOperation,
  notes: readonly Note[],
  folders: readonly Folder[],
): boolean {
  if (operation.phase !== 'prepared') return true;

  if (operation.kind === 'delete-note') {
    return !notes.some((note) => note.id === operation.note.id);
  }

  if (operation.kind === 'delete-folder') {
    return !folders.some((folder) => folder.id === operation.folder.id);
  }

  const desired = operation.nextFolders.find((folder) => folder.id === operation.folderId);
  const current = folders.find((folder) => folder.id === operation.folderId);
  return Boolean(desired && current && current.name === desired.name);
}

export function commitVaultPendingOperation(
  operation: VaultPendingOperation,
): VaultPendingOperation {
  return { ...operation, phase: 'committed' };
}
