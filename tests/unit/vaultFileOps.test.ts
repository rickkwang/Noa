import { describe, expect, it } from 'vitest';
import { deleteNoteFile, scanDirectory, writeNote } from '../../src/lib/fileSystemStorage';
import { syncFolderRename, syncNoteRename } from '../../src/services/fileSyncService';
import { createMemRoot, listPaths, readFileText, resolvePath } from './helpers/memfs';
import type { Note } from '../../src/types';

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'a1a1a1a1-0000-4000-8000-000000000001',
  title: 'Sample',
  content: '# Sample',
  createdAt: '2026-04-09T12:00:00.000Z',
  updatedAt: '2026-04-09T12:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
  source: 'obsidian-import',
  ...overrides,
});

// Cast helper: the mock implements the subset of FileSystemDirectoryHandle
// that fileSystemStorage actually touches.
const asFsHandle = (root: ReturnType<typeof createMemRoot>) =>
  root as unknown as FileSystemDirectoryHandle;

describe('deleteNoteFile with duplicate titles', () => {
  it('deletes the file owned by the note id, not the same-titled sibling', async () => {
    const root = createMemRoot();
    const noteA = makeNote({ id: 'a1a1a1a1-0000-4000-8000-000000000001', content: 'note A' });
    const noteB = makeNote({ id: 'b2b2b2b2-0000-4000-8000-000000000002', content: 'note B' });

    await writeNote(asFsHandle(root), noteA, []);
    await writeNote(asFsHandle(root), noteB, []);

    // Collision handling gives B a suffixed filename.
    expect(await readFileText(root, 'Sample.md')).toBe('note A');
    expect(await readFileText(root, 'Sample_b2b2b2b2.md')).toBe('note B');

    await deleteNoteFile(asFsHandle(root), noteB, []);

    // A's file must survive; only B's file may be removed.
    expect(await readFileText(root, 'Sample.md')).toBe('note A');
    expect(resolvePath(root, 'Sample_b2b2b2b2.md')).toBeNull();
  });

  it('falls back to title heuristics without touching paths owned by other notes', async () => {
    const root = createMemRoot();
    const noteA = makeNote({ id: 'a1a1a1a1-0000-4000-8000-000000000001', content: 'note A' });
    await writeNote(asFsHandle(root), noteA, []);

    // A note that was never written through writeNote (no manifest entry).
    const unmanaged = makeNote({ id: 'c3c3c3c3-0000-4000-8000-000000000003' });
    await deleteNoteFile(asFsHandle(root), unmanaged, []);

    expect(await readFileText(root, 'Sample.md')).toBe('note A');
  });
});

describe('syncNoteRename', () => {
  it('keeps the vault attachments directory of the renamed note', async () => {
    const root = createMemRoot();
    const note = makeNote();
    await writeNote(asFsHandle(root), note, []);

    // Simulate a previously synced attachment on disk.
    const attachmentsDir = await root.getDirectoryHandle('attachments', { create: true });
    const noteDir = await attachmentsDir.getDirectoryHandle(note.id, { create: true });
    const file = await noteDir.getFileHandle('photo.png', { create: true });
    const writable = await file.createWritable();
    await writable.write('binary');
    await writable.close();

    await syncNoteRename(asFsHandle(root), note, 'Renamed', []);

    expect(await readFileText(root, 'Renamed.md')).toBe('# Sample');
    expect(resolvePath(root, 'Sample.md')).toBeNull();
    expect(await readFileText(root, `attachments/${note.id}/photo.png`)).toBe('binary');
  });

  it('renames a duplicate-titled note without touching its sibling file', async () => {
    const root = createMemRoot();
    const noteA = makeNote({ id: 'a1a1a1a1-0000-4000-8000-000000000001', content: 'note A' });
    const noteB = makeNote({ id: 'b2b2b2b2-0000-4000-8000-000000000002', content: 'note B' });
    await writeNote(asFsHandle(root), noteA, []);
    await writeNote(asFsHandle(root), noteB, []);

    await syncNoteRename(asFsHandle(root), noteB, 'Unique Title', []);

    expect(await readFileText(root, 'Sample.md')).toBe('note A');
    expect(resolvePath(root, 'Sample_b2b2b2b2.md')).toBeNull();
    expect(await readFileText(root, 'Unique Title.md')).toBe('note B');
  });

  it('still removes attachments on real deletion', async () => {
    const root = createMemRoot();
    const note = makeNote();
    await writeNote(asFsHandle(root), note, []);
    const attachmentsDir = await root.getDirectoryHandle('attachments', { create: true });
    const noteDir = await attachmentsDir.getDirectoryHandle(note.id, { create: true });
    await noteDir.getFileHandle('photo.png', { create: true });

    await deleteNoteFile(asFsHandle(root), note, []);

    expect(resolvePath(root, `attachments/${note.id}`)).toBeNull();
    expect(resolvePath(root, 'Sample.md')).toBeNull();
    // Sanity: nothing else left behind except the manifest and attachments root.
    expect(listPaths(root)).toEqual(['attachments/', 'manifest.json']);
  });
});

describe('syncFolderRename', () => {
  const folderId = 'f1f1f1f1-0000-4000-8000-00000000000f';

  it('moves managed notes but preserves files Noa does not track', async () => {
    const root = createMemRoot();
    const oldFolders = [{ id: folderId, name: 'Old Folder', source: 'obsidian-import' as const }];
    const note = makeNote({ folder: folderId, content: 'managed note' });
    await writeNote(asFsHandle(root), note, oldFolders);

    // An untracked vault file living in the same folder (e.g. a PDF kept in Obsidian).
    const oldDir = resolvePath(root, 'Old Folder');
    expect(oldDir?.kind).toBe('directory');
    await (oldDir as ReturnType<typeof createMemRoot>).getFileHandle('reference.pdf', { create: true });

    const newFolders = [{ id: folderId, name: 'New Folder', source: 'obsidian-import' as const }];
    await syncFolderRename(asFsHandle(root), folderId, 'Old Folder', newFolders, [note]);

    // Managed note moved to the renamed directory.
    expect(await readFileText(root, 'New Folder/Sample.md')).toBe('managed note');
    expect(resolvePath(root, 'Old Folder/Sample.md')).toBeNull();
    // Untracked file must survive in place.
    expect(resolvePath(root, 'Old Folder/reference.pdf')).not.toBeNull();
  });

  it('removes the old directory tree when it only contained managed notes', async () => {
    const root = createMemRoot();
    const oldFolders = [{ id: folderId, name: 'Old Folder', source: 'obsidian-import' as const }];
    const note = makeNote({ folder: folderId, content: 'managed note' });
    await writeNote(asFsHandle(root), note, oldFolders);

    const newFolders = [{ id: folderId, name: 'New Folder', source: 'obsidian-import' as const }];
    await syncFolderRename(asFsHandle(root), folderId, 'Old Folder', newFolders, [note]);

    expect(await readFileText(root, 'New Folder/Sample.md')).toBe('managed note');
    expect(resolvePath(root, 'Old Folder')).toBeNull();
  });

  it('moves notes in nested subfolders and keeps untracked nested files', async () => {
    const root = createMemRoot();
    const childId = 'c1c1c1c1-0000-4000-8000-00000000000c';
    const oldFolders = [
      { id: folderId, name: 'Old Folder', source: 'obsidian-import' as const },
      { id: childId, name: 'Old Folder/Child', source: 'obsidian-import' as const },
    ];
    const nested = makeNote({ id: 'd4d4d4d4-0000-4000-8000-000000000004', folder: childId, content: 'nested note' });
    await writeNote(asFsHandle(root), nested, oldFolders);
    const childDir = resolvePath(root, 'Old Folder/Child');
    await (childDir as ReturnType<typeof createMemRoot>).getFileHandle('drawing.canvas', { create: true });

    const newFolders = [
      { id: folderId, name: 'New Folder', source: 'obsidian-import' as const },
      { id: childId, name: 'New Folder/Child', source: 'obsidian-import' as const },
    ];
    await syncFolderRename(asFsHandle(root), folderId, 'Old Folder', newFolders, [nested]);

    expect(await readFileText(root, 'New Folder/Child/Sample.md')).toBe('nested note');
    expect(resolvePath(root, 'Old Folder/Child/drawing.canvas')).not.toBeNull();
    expect(resolvePath(root, 'Old Folder/Child/Sample.md')).toBeNull();
  });
});

describe('manifest path consistency for folders with spaces', () => {
  it('writes manifest keys that match the real on-disk directory layout', async () => {
    const root = createMemRoot();
    const folders = [{ id: 'f1', name: 'My Notes', source: 'obsidian-import' as const }];
    await writeNote(asFsHandle(root), makeNote({ folder: 'f1' }), folders);

    expect(await readFileText(root, 'My Notes/Sample.md')).toBe('# Sample');
    const manifest = JSON.parse((await readFileText(root, 'manifest.json')) ?? '{}');
    expect(Object.keys(manifest.notes)).toEqual(['My Notes/Sample.md']);
  });

  it('scanDirectory reuses existing folders whose names contain spaces', async () => {
    const root = createMemRoot();
    const folders = [{ id: 'f1', name: 'My Notes', source: 'obsidian-import' as const }];
    await writeNote(asFsHandle(root), makeNote({ folder: 'f1' }), folders);

    const { notes, newFolders } = await scanDirectory(asFsHandle(root), folders);

    expect(newFolders).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0].folder).toBe('f1');
    // Manifest entry must resolve, so the note keeps its stable id across scans.
    expect(notes[0].id).toBe('a1a1a1a1-0000-4000-8000-000000000001');
  });
});
