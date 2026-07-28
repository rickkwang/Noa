import { describe, expect, it } from 'vitest';
import {
  buildRenamedFolderList,
  buildVaultNoteDeleteOperations,
  computeFolderIdsToDelete,
  partitionFolderDeleteOutcomes,
  selectUnclaimedOperations,
} from '../../src/lib/vaultOps';
import type { Folder, Note, VaultPendingOperation } from '../../src/types';

const noaFolder: Folder = { id: 'nf-1', name: 'projects', source: 'noa' };
const vaultRoot: Folder = { id: 'vf-1', name: 'projects', origin: 'vault' };
const vaultChild: Folder = { id: 'vf-2', name: 'projects/docs', origin: 'vault' };
const vaultGrandchild: Folder = { id: 'vf-3', name: 'projects/docs/deep', origin: 'vault' };
const unrelated: Folder = { id: 'vf-4', name: 'other', origin: 'vault' };

const vaultNote: Note = {
  id: 'note-1',
  title: 'Doc',
  content: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  folder: 'vf-2',
  tags: [],
  links: [],
  linkRefs: [],
  origin: 'vault',
};

const noaNote: Note = { ...vaultNote, id: 'note-2', folder: 'nf-1', origin: undefined };

describe('buildRenamedFolderList', () => {
  it('renames the target and rewrites same-domain descendant prefixes', () => {
    const next = buildRenamedFolderList(
      [vaultRoot, vaultChild, vaultGrandchild, unrelated],
      'vf-1', 'projects', 'work', true,
    );
    expect(next.find((f) => f.id === 'vf-1')?.name).toBe('work');
    expect(next.find((f) => f.id === 'vf-2')?.name).toBe('work/docs');
    expect(next.find((f) => f.id === 'vf-3')?.name).toBe('work/docs/deep');
    expect(next.find((f) => f.id === 'vf-4')?.name).toBe('other');
  });

  it('never rewrites folders across the vault/noa boundary even when names match', () => {
    const next = buildRenamedFolderList([noaFolder, vaultRoot, vaultChild], 'nf-1', 'projects', 'work', false);
    expect(next.find((f) => f.id === 'nf-1')?.name).toBe('work');
    expect(next.find((f) => f.id === 'vf-1')?.name).toBe('projects');
    expect(next.find((f) => f.id === 'vf-2')?.name).toBe('projects/docs');
  });
});

describe('computeFolderIdsToDelete', () => {
  it('collects the target and same-domain descendants only', () => {
    const ids = computeFolderIdsToDelete([vaultRoot, vaultChild, noaFolder, unrelated], 'vf-1');
    expect(ids).toEqual(new Set(['vf-1', 'vf-2']));
  });

  it('includes the target alone when it has no descendants', () => {
    expect(computeFolderIdsToDelete([vaultRoot, unrelated], 'vf-4')).toEqual(new Set(['vf-4']));
  });

  it('does not sweep a noa folder whose name matches a vault directory', () => {
    const ids = computeFolderIdsToDelete([noaFolder, vaultRoot, vaultChild], 'nf-1');
    expect(ids).toEqual(new Set(['nf-1']));
  });

  it('matches descendants by path prefix, not by segment similarity', () => {
    const sibling: Folder = { id: 'vf-9', name: 'projects-old', origin: 'vault' };
    const ids = computeFolderIdsToDelete([vaultRoot, vaultChild, sibling], 'vf-1');
    expect(ids).toEqual(new Set(['vf-1', 'vf-2']));
  });
});

describe('buildVaultNoteDeleteOperations', () => {
  it('builds prepared delete-note operations for vault notes in the deleted folders', () => {
    const operations = buildVaultNoteDeleteOperations(
      [vaultNote, noaNote],
      [vaultRoot, vaultChild],
      new Set(['vf-2']),
    );
    expect(operations.size).toBe(1);
    const operation = operations.get('note-1');
    expect(operation?.kind).toBe('delete-note');
    expect(operation?.phase).toBe('prepared');
    expect(operation?.entityKey).toBe('note:note-1');
    const secondRun = buildVaultNoteDeleteOperations([vaultNote], [vaultRoot, vaultChild], new Set(['vf-2']));
    expect(secondRun.get('note-1')?.key).not.toBe(operation?.key);
  });

  it('skips notes outside the deleted folder set and noa-owned notes', () => {
    const operations = buildVaultNoteDeleteOperations(
      [vaultNote, noaNote],
      [vaultRoot],
      new Set(['vf-4']),
    );
    expect(operations.size).toBe(0);
  });
});

describe('partitionFolderDeleteOutcomes', () => {
  it('hands off operations for deleted notes and cancels the rest', () => {
    const operations = buildVaultNoteDeleteOperations(
      [vaultNote, { ...vaultNote, id: 'note-3', folder: 'vf-3' }],
      [vaultChild],
      new Set(['vf-2', 'vf-3']),
    );
    const { handoff, cancel } = partitionFolderDeleteOutcomes(
      [vaultNote, { ...vaultNote, id: 'note-3', folder: 'vf-3' }],
      operations,
      new Set(['note-1']),
    );
    expect(handoff.map((entry) => entry.note.id)).toEqual(['note-1']);
    expect(cancel.map((operation) => operation.entityKey)).toEqual(['note:note-3']);
  });

  it('tolerates a candidate note with no prepared operation', () => {
    const { handoff, cancel } = partitionFolderDeleteOutcomes([noaNote], new Map(), new Set(['note-2']));
    expect(handoff).toEqual([]);
    expect(cancel).toEqual([]);
  });
});

describe('selectUnclaimedOperations', () => {
  it('returns only operations that were never handed off', () => {
    const operations = buildVaultNoteDeleteOperations([vaultNote], [], new Set(['vf-2']));
    const prepared = Array.from(operations.values());
    const handedOff = new Set([prepared[0].key]);
    expect(selectUnclaimedOperations(prepared, handedOff)).toEqual([]);
    expect(selectUnclaimedOperations(prepared, new Set())).toEqual(prepared);
  });
});

// Type-level guard: operations must satisfy the VaultPendingOperation union.
const _typeCheck: VaultPendingOperation | undefined = buildVaultNoteDeleteOperations(
  [vaultNote], [vaultChild], new Set(['vf-2']),
).get('note-1');
void _typeCheck;
