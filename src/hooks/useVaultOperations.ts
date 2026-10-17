import { useCallback, useEffect, useRef } from 'react';
import { deleteNoteWithLocalFirst } from '../lib/deleteFlow';
import {
  buildRenamedFolderList,
  buildVaultNoteDeleteOperations,
  computeFolderIdsToDelete,
  partitionFolderDeleteOutcomes,
  selectUnclaimedOperations,
  wouldBreakVaultLinks,
} from '../lib/vaultOps';
import type { Folder, Note, VaultPendingOperation } from '../types';

interface UseVaultOperationsOptions {
  isDataReady: boolean;
  notes: Note[];
  folders: Folder[];
  setSaveError: (message: string) => void;
  closeTabById: (id: string) => void;
  blockVaultCacheWrite: (isVaultOwned: boolean) => boolean;
  // useNotes handlers
  handleDeleteNote: (id: string) => Promise<boolean>;
  handleRenameFolder: (id: string, newName: string) => Promise<void>;
  handleDeleteFolder: (id: string) => Promise<{ deletedNoteIds: string[]; foldersDeleted: boolean }>;
  clearWorkspaceAfterDisconnect: () => Promise<string[]>;
  // useFileSync surface
  isVaultEntityOperationPending: (entityKey: string) => boolean;
  reserveVaultStructuralOperation: (entityKey: string) => boolean;
  releaseVaultStructuralOperation: (entityKey: string) => void;
  prepareVaultStructuralOperations: (operations: readonly VaultPendingOperation[]) => Promise<void>;
  cancelVaultStructuralOperations: (operations: readonly VaultPendingOperation[]) => Promise<void>;
  hasPendingStructuralOperations: boolean;
  beginDisconnect: () => void;
  cancelDisconnect: () => void;
  disconnect: () => Promise<void>;
  syncNoteOnDelete: (note: Note, prepared?: VaultPendingOperation) => void;
  syncFolderOnRename: (folderId: string, previousName: string, nextFolders: Folder[], prepared?: VaultPendingOperation) => void;
  syncFolderOnDelete: (folder: Folder, prepared?: VaultPendingOperation) => void;
}

export function useVaultOperations({
  isDataReady,
  notes,
  folders,
  setSaveError,
  closeTabById,
  blockVaultCacheWrite,
  handleDeleteNote: _handleDeleteNote,
  handleRenameFolder: _handleRenameFolder,
  handleDeleteFolder: _handleDeleteFolder,
  clearWorkspaceAfterDisconnect,
  isVaultEntityOperationPending,
  reserveVaultStructuralOperation,
  releaseVaultStructuralOperation,
  prepareVaultStructuralOperations,
  cancelVaultStructuralOperations,
  hasPendingStructuralOperations,
  beginDisconnect,
  cancelDisconnect,
  disconnect,
  syncNoteOnDelete,
  syncFolderOnRename,
  syncFolderOnDelete,
}: UseVaultOperationsOptions) {
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  const blockPendingVaultEntityOperation = useCallback((entityKey: string) => {
    if (!isVaultEntityOperationPending(entityKey)) return false;
    setSaveError('A vault file operation is still pending for this item. Retry sync before changing it again.');
    return true;
  }, [isVaultEntityOperationPending, setSaveError]);

  const handleDeleteNotes = useCallback(async (ids: string[]): Promise<Note[]> => {
    if (!isDataReady) return [];
    const targets = [...new Set(ids)]
      .map((id) => notesRef.current.find((note) => note.id === id))
      .filter((note): note is Note => Boolean(note));
    if (targets.length === 0) return [];
    const vaultNotes = targets.filter((note) => note.origin === 'vault');
    if (vaultNotes.length > 0 && blockVaultCacheWrite(true)) return [];
    const busyEntity = vaultNotes.find((note) => isVaultEntityOperationPending(`note:${note.id}`));
    if (busyEntity) {
      blockPendingVaultEntityOperation(`note:${busyEntity.id}`);
      return [];
    }
    const reservationKey = vaultNotes.length > 0 ? `delete-notes:${vaultNotes[0].id}` : null;
    if (reservationKey && !reserveVaultStructuralOperation(reservationKey)) {
      setSaveError('A vault file operation is still pending. Retry sync before deleting these notes.');
      return [];
    }
    const noteOperations = buildVaultNoteDeleteOperations(
      vaultNotes,
      folders.filter((folder) => folder.origin === 'vault'),
      new Set(vaultNotes.map((note) => note.folder)),
    );
    const preparedOperations = [...noteOperations.values()];
    const handedOffOperationKeys = new Set<string>();
    const deletedNotes: Note[] = [];
    try {
      if (preparedOperations.length > 0) await prepareVaultStructuralOperations(preparedOperations);
      for (const note of targets) {
        const operation = noteOperations.get(note.id);
        const deleted = await deleteNoteWithLocalFirst({
          id: note.id,
          deleteLocal: _handleDeleteNote,
          closeTab: closeTabById,
          syncDelete: () => {
            if (operation) {
              syncNoteOnDelete(note, operation);
              handedOffOperationKeys.add(operation.key);
            }
          },
        });
        if (deleted) deletedNotes.push(note);
        else if (operation) await cancelVaultStructuralOperations([operation]);
      }
    } catch (error) {
      const unclaimedOperations = selectUnclaimedOperations(preparedOperations, handedOffOperationKeys);
      if (unclaimedOperations.length > 0) {
        await cancelVaultStructuralOperations(unclaimedOperations).catch(() => {});
      }
      setSaveError(error instanceof Error ? error.message : 'Failed to delete the notes.');
    } finally {
      if (reservationKey) releaseVaultStructuralOperation(reservationKey);
    }
    return deletedNotes;
  }, [_handleDeleteNote, blockPendingVaultEntityOperation, blockVaultCacheWrite, cancelVaultStructuralOperations, closeTabById, folders, isDataReady, isVaultEntityOperationPending, prepareVaultStructuralOperations, releaseVaultStructuralOperation, reserveVaultStructuralOperation, setSaveError, syncNoteOnDelete]);

  const handleDeleteNote = useCallback((id: string) => handleDeleteNotes([id]), [handleDeleteNotes]);

  const handleRenameFolder = useCallback((id: string, newName: string) => {
    const oldFolder = folders.find((folder) => folder.id === id);
    if (!oldFolder) return;
    if (blockVaultCacheWrite(oldFolder.origin === 'vault')) return;
    const previousName = oldFolder.name;
    const nextName = newName.trim() || 'Untitled Folder';
    const nextFolders = buildRenamedFolderList(folders, id, previousName, nextName, oldFolder.origin === 'vault');
    if (oldFolder.origin === 'vault' && wouldBreakVaultLinks(notesRef.current, folders, notesRef.current, nextFolders)) {
      setSaveError('Renaming this folder would break existing vault links. Update the links in your vault editor before renaming it.');
      return;
    }
    const entityKey = `folder:${id}`;
    const needsVaultReservation = oldFolder.origin === 'vault';
    if (needsVaultReservation && blockPendingVaultEntityOperation(entityKey)) return;
    if (needsVaultReservation && !reserveVaultStructuralOperation(entityKey)) {
      setSaveError('A vault file operation is still pending. Retry sync before changing this folder.');
      return;
    }
    if (!needsVaultReservation) {
      void _handleRenameFolder(id, newName).catch(() => {});
      return;
    }

    const operation: VaultPendingOperation = {
      key: `${entityKey}:rename:${crypto.randomUUID()}`,
      entityKey,
      kind: 'rename-folder',
      phase: 'prepared',
      folderId: id,
      previousName,
      nextFolders,
    };
    void (async () => {
      try {
        await prepareVaultStructuralOperations([operation]);
        await _handleRenameFolder(id, newName);
        syncFolderOnRename(id, previousName, nextFolders, operation);
      } catch (error) {
        await cancelVaultStructuralOperations([operation]).catch(() => {
          releaseVaultStructuralOperation(entityKey);
        });
        setSaveError(error instanceof Error ? error.message : 'Failed to prepare the vault folder rename.');
      }
    })();
  }, [_handleRenameFolder, blockPendingVaultEntityOperation, blockVaultCacheWrite, cancelVaultStructuralOperations, folders, prepareVaultStructuralOperations, releaseVaultStructuralOperation, reserveVaultStructuralOperation, setSaveError, syncFolderOnRename]);

  const handleDeleteFolder = useCallback((id: string) => {
    const deletedFolder = folders.find((folder) => folder.id === id);
    if (blockVaultCacheWrite(deletedFolder?.origin === 'vault')) return;
    const entityKey = `folder:${id}`;
    const needsVaultReservation = deletedFolder?.origin === 'vault';
    if (needsVaultReservation && blockPendingVaultEntityOperation(entityKey)) return;
    if (needsVaultReservation && !reserveVaultStructuralOperation(entityKey)) {
      setSaveError('A vault file operation is still pending. Retry sync before deleting this folder.');
      return;
    }
    const notesBeforeDelete = new Map(notesRef.current.map((note) => [note.id, note]));
    const folderIdsToDelete = computeFolderIdsToDelete(folders, id);
    const candidateNotes = Array.from(notesBeforeDelete.values()).filter(
      (note) => note.origin === 'vault' && folderIdsToDelete.has(note.folder),
    );
    const noteOperations = buildVaultNoteDeleteOperations(
      candidateNotes,
      folders.filter((folder) => folder.origin === 'vault'),
      folderIdsToDelete,
    );
    const folderOperation: VaultPendingOperation | undefined = deletedFolder?.origin === 'vault' ? {
      key: `${entityKey}:delete:${crypto.randomUUID()}`,
      entityKey,
      kind: 'delete-folder',
      phase: 'prepared',
      folder: deletedFolder,
    } : undefined;
    const preparedOperations = [
      ...noteOperations.values(),
      ...(folderOperation ? [folderOperation] : []),
    ];
    const handedOffOperationKeys = new Set<string>();
    void (async () => {
      try {
        if (preparedOperations.length > 0) await prepareVaultStructuralOperations(preparedOperations);
        const { deletedNoteIds, foldersDeleted } = await _handleDeleteFolder(id);
        const deletedSet = new Set(deletedNoteIds);
        deletedNoteIds.forEach((noteId) => closeTabById(noteId));
        const { handoff, cancel } = partitionFolderDeleteOutcomes(candidateNotes, noteOperations, deletedSet);
        handoff.forEach(({ note, operation }) => {
          syncNoteOnDelete(note, operation);
          handedOffOperationKeys.add(operation.key);
        });
        const canceledOperations = [...cancel];
        // Mirror mode: only vault folders have a disk directory; never run disk cleanup for a Noa-owned folder (its name could match an unrelated vault dir).
        if (deletedFolder && folderOperation && foldersDeleted) {
          syncFolderOnDelete(deletedFolder, folderOperation);
          handedOffOperationKeys.add(folderOperation.key);
        } else if (folderOperation) {
          canceledOperations.push(folderOperation);
        }
        if (canceledOperations.length > 0) await cancelVaultStructuralOperations(canceledOperations);
      } catch (err) {
        const unclaimedOperations = selectUnclaimedOperations(preparedOperations, handedOffOperationKeys);
        if (unclaimedOperations.length > 0) {
          await cancelVaultStructuralOperations(unclaimedOperations).catch(() => {
            if (needsVaultReservation) releaseVaultStructuralOperation(entityKey);
          });
        } else if (needsVaultReservation) {
          releaseVaultStructuralOperation(entityKey);
        }
        console.error('[App] handleDeleteFolder failed:', err);
        setSaveError(err instanceof Error ? err.message : 'Failed to prepare the vault folder delete.');
      }
    })();
  }, [_handleDeleteFolder, blockPendingVaultEntityOperation, blockVaultCacheWrite, cancelVaultStructuralOperations, closeTabById, folders, prepareVaultStructuralOperations, releaseVaultStructuralOperation, reserveVaultStructuralOperation, setSaveError, syncFolderOnDelete, syncNoteOnDelete]);

  const handleDisconnectFolder = useCallback(async () => {
    if (!isDataReady) return;
    let disconnectStarted = false;
    try {
      if (notesRef.current.some((note) => note.origin === 'vault' && note.vaultDirty)) {
        throw new Error('Some vault edits have not reached disk yet. Retry sync before disconnecting.');
      }
      if (hasPendingStructuralOperations) {
        throw new Error('Vault file operations are still pending. Retry sync before disconnecting.');
      }
      beginDisconnect();
      disconnectStarted = true;
      const deletedNoteIds = await clearWorkspaceAfterDisconnect();
      deletedNoteIds.forEach((id) => closeTabById(id));
      await disconnect();
    } catch (err) {
      if (disconnectStarted) cancelDisconnect();
      console.error('[App] handleDisconnectFolder failed:', err);
      setSaveError(err instanceof Error
        ? err.message
        : 'Failed to disconnect vault. Check folder permissions and retry.');
      throw err;
    }
  }, [beginDisconnect, cancelDisconnect, disconnect, clearWorkspaceAfterDisconnect, closeTabById, hasPendingStructuralOperations, isDataReady, setSaveError]);

  return {
    handleDeleteNote,
    handleDeleteNotes,
    handleRenameFolder,
    handleDeleteFolder,
    handleDisconnectFolder,
  };
}
