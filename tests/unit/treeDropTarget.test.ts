import { describe, expect, it } from 'vitest';
import { resolveTreeDrop, TreeDragItem } from '../../src/lib/treeDropTarget';
import type { Folder, Note } from '../../src/types';

const note = (over: Partial<Note> & Pick<Note, 'id'>): Note => ({
  title: over.id,
  content: '',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
  ...over,
});

const folder = (id: string, name: string, origin?: 'vault'): Folder =>
  ({ id, name, ...(origin ? { origin } : {}) }) as Folder;

// projects/            f1
// projects/alpha/      f2
// archive/             f3
const folders = [
  folder('f1', 'projects'),
  folder('f2', 'projects/alpha'),
  folder('f3', 'archive'),
  folder('v1', 'vault-notes', 'vault'),
];
const notes = [
  note({ id: 'n-root' }),
  note({ id: 'n1', folder: 'f1' }),
  note({ id: 'n-vault', folder: 'v1', origin: 'vault' }),
];

const drag = (kind: 'note' | 'folder', id: string): TreeDragItem => ({ kind, id, name: id });
const resolve = (item: TreeDragItem, target: string | null, rootIsVault = false) =>
  resolveTreeDrop(item, target, rootIsVault, notes, folders);

describe('resolveTreeDrop — notes', () => {
  it('moves a note into another folder', () => {
    expect(resolve(drag('note', 'n1'), 'f3')).toEqual({ kind: 'note', noteId: 'n1', folderId: 'f3' });
  });

  it('moves a note out to the root', () => {
    expect(resolve(drag('note', 'n1'), null)).toEqual({ kind: 'note', noteId: 'n1', folderId: '' });
  });

  it('is a no-op landing, not a refusal, when the note is already in the target folder', () => {
    expect(resolve(drag('note', 'n1'), 'f1').kind).toBe('noop');
  });

  it('is a no-op landing, not a refusal, when a root note is dropped on the root', () => {
    expect(resolve(drag('note', 'n-root'), null).kind).toBe('noop');
  });

  it('refuses to cross the vault/noa ownership boundary', () => {
    expect(resolve(drag('note', 'n-vault'), 'f1').kind).toBe('none');
    expect(resolve(drag('note', 'n1'), 'v1').kind).toBe('none');
    expect(resolve(drag('note', 'n-vault'), null, false).kind).toBe('none');
    expect(resolve(drag('note', 'n-vault'), null, true)).toEqual({ kind: 'note', noteId: 'n-vault', folderId: '' });
  });
});

describe('resolveTreeDrop — folders', () => {
  it('moves a folder under another folder, keeping its leaf name', () => {
    expect(resolve(drag('folder', 'f1'), 'f3')).toEqual({ kind: 'folder', folderId: 'f1', nextPath: 'archive/projects' });
  });

  it('moves a nested folder out to the root', () => {
    expect(resolve(drag('folder', 'f2'), null)).toEqual({ kind: 'folder', folderId: 'f2', nextPath: 'alpha' });
  });

  it('does nothing when dropped on itself', () => {
    expect(resolve(drag('folder', 'f1'), 'f1').kind).toBe('none');
  });

  it('does nothing when dropped into its own descendant', () => {
    expect(resolve(drag('folder', 'f1'), 'f2').kind).toBe('none');
  });

  it('is a no-op landing, not a refusal, when dropped on the parent it already sits in', () => {
    expect(resolve(drag('folder', 'f2'), 'f1').kind).toBe('noop');
  });

  it('is a no-op landing, not a refusal, when a root folder is dropped on the root', () => {
    expect(resolve(drag('folder', 'f1'), null).kind).toBe('noop');
  });

  it('refuses to cross the vault/noa ownership boundary', () => {
    expect(resolve(drag('folder', 'f1'), 'v1').kind).toBe('none');
    expect(resolve(drag('folder', 'v1'), 'f1').kind).toBe('none');
  });
});

describe('resolveTreeDrop — folder name collisions', () => {
  // projects/          f1        archive/           f3
  // archive/projects   f4        archive/Alpha      f5
  // vault-notes/       v1        vault-notes/projects  v2
  const withSiblings = [
    folder('f1', 'projects'),
    folder('f2', 'projects/alpha'),
    folder('f3', 'archive'),
    folder('f4', 'archive/projects'),
    folder('f5', 'archive/Alpha'),
    folder('v1', 'vault-notes', 'vault'),
    folder('v2', 'vault-notes/projects', 'vault'),
  ];
  const into = (id: string, target: string | null, rootIsVault = false) =>
    resolveTreeDrop(drag('folder', id), target, rootIsVault, [], withSiblings);

  it('refuses a move that would land beside a sibling of the same name', () => {
    expect(into('f1', 'f3').kind).toBe('none');
  });

  it('matches sibling names case-insensitively, like the rename dialog', () => {
    expect(into('f2', 'f3').kind).toBe('none');
  });

  it('refuses a move out to a root already holding that name', () => {
    expect(into('f4', null).kind).toBe('none');
  });

  it('does not see a same-named folder under a different parent as a collision', () => {
    const noClash = [folder('a', 'one'), folder('b', 'two'), folder('c', 'three/one')];
    expect(resolveTreeDrop(drag('folder', 'a'), 'b', false, [], noClash))
      .toEqual({ kind: 'folder', folderId: 'a', nextPath: 'two/one' });
  });

  it('does not see a same-named folder across the ownership boundary as a collision', () => {
    // `vault-notes/projects` must not block noa's `projects` from entering `archive`
    const crossOwned = [folder('f1', 'projects'), folder('f3', 'archive'), folder('v2', 'archive/projects', 'vault')];
    expect(resolveTreeDrop(drag('folder', 'f1'), 'f3', false, [], crossOwned))
      .toEqual({ kind: 'folder', folderId: 'f1', nextPath: 'archive/projects' });
  });

  it('still reports the already-there landing as noop, not a self-collision', () => {
    expect(into('f4', 'f3').kind).toBe('noop');
  });
});

describe('resolveTreeDrop — missing entities', () => {
  it('resolves to none for an unknown id', () => {
    expect(resolve(drag('note', 'nope'), 'f1').kind).toBe('none');
    expect(resolve(drag('folder', 'nope'), 'f1').kind).toBe('none');
  });

  it('resolves to none for an unknown target folder', () => {
    expect(resolve(drag('note', 'n1'), 'nope').kind).toBe('none');
  });
});
