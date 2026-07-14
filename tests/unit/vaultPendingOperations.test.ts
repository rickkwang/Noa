import { describe, expect, it } from 'vitest';
import {
  selectVaultPendingOperations,
  shouldReplayVaultPendingOperation,
} from '../../src/lib/vaultPendingOperations';
import type { Folder, Note, VaultPendingOperation } from '../../src/types';

const note: Note = {
  id: 'note-1',
  title: 'Note',
  content: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  folder: 'folder-1',
  tags: [],
  links: [],
  linkRefs: [],
  origin: 'vault',
};

const oldFolder: Folder = { id: 'folder-1', name: 'Old', origin: 'vault' };
const newFolder: Folder = { id: 'folder-1', name: 'New', origin: 'vault' };

describe('shouldReplayVaultPendingOperation', () => {
  it('cancels a prepared note delete when the local row still exists', () => {
    const operation: VaultPendingOperation = {
      key: 'delete-note:1',
      entityKey: `note:${note.id}`,
      kind: 'delete-note',
      phase: 'prepared',
      note,
      folders: [oldFolder],
    };

    expect(shouldReplayVaultPendingOperation(operation, [note], [oldFolder])).toBe(false);
    expect(shouldReplayVaultPendingOperation(operation, [], [oldFolder])).toBe(true);
  });

  it('replays a prepared rename only when the desired local folder landed', () => {
    const operation: VaultPendingOperation = {
      key: 'rename-folder:1',
      entityKey: `folder:${oldFolder.id}`,
      kind: 'rename-folder',
      phase: 'prepared',
      folderId: oldFolder.id,
      previousName: oldFolder.name,
      nextFolders: [newFolder],
    };

    expect(shouldReplayVaultPendingOperation(operation, [note], [oldFolder])).toBe(false);
    expect(shouldReplayVaultPendingOperation(operation, [note], [newFolder])).toBe(true);
  });

  it('replays a prepared folder delete only after the local folder is absent', () => {
    const operation: VaultPendingOperation = {
      key: 'delete-folder:1',
      entityKey: `folder:${oldFolder.id}`,
      kind: 'delete-folder',
      phase: 'prepared',
      folder: oldFolder,
    };

    expect(shouldReplayVaultPendingOperation(operation, [], [oldFolder])).toBe(false);
    expect(shouldReplayVaultPendingOperation(operation, [], [])).toBe(true);
  });

  it('always replays an explicitly committed operation', () => {
    const operation: VaultPendingOperation = {
      key: 'delete-note:2',
      entityKey: `note:${note.id}`,
      kind: 'delete-note',
      phase: 'committed',
      note,
      folders: [oldFolder],
    };

    expect(shouldReplayVaultPendingOperation(operation, [note], [oldFolder])).toBe(true);
  });
});

describe('selectVaultPendingOperations', () => {
  it('does not replay operations from another vault', () => {
    const operation: VaultPendingOperation = {
      key: 'delete-note:foreign',
      entityKey: `note:${note.id}`,
      kind: 'delete-note',
      vaultId: 'vault-a',
      note,
      folders: [oldFolder],
    };

    expect(selectVaultPendingOperations([operation], 'vault-b', 'vault-a')).toEqual([]);
  });

  it('binds legacy operations only when the last confirmed vault matches', () => {
    const operation: VaultPendingOperation = {
      key: 'delete-note:legacy',
      entityKey: `note:${note.id}`,
      kind: 'delete-note',
      note,
      folders: [oldFolder],
    };

    expect(selectVaultPendingOperations([operation], 'vault-a', 'vault-a')[0]).toMatchObject({ vaultId: 'vault-a' });
    expect(selectVaultPendingOperations([operation], 'vault-b', 'vault-a')).toEqual([]);
  });
});
