import { describe, expect, it } from 'vitest';
import { deleteNoteFile, scanDirectory, scanNoteFileStats, writeNote } from '../../src/lib/fileSystemStorage';
import { mergeScannedNotes, syncFolderCreate, syncFolderDelete, syncFolderRename, syncNoteRename, syncNoteUpdate } from '../../src/services/fileSyncService';
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

async function writeRawFile(root: ReturnType<typeof createMemRoot>, path: string, content: string) {
  const segments = path.split('/').filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) throw new Error('Missing filename');
  let dir = root;
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  const file = await dir.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
}

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
    expect(listPaths(root)).toEqual(['.noa/', '.noa/manifest.json', 'attachments/']);
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
    const manifest = JSON.parse((await readFileText(root, '.noa/manifest.json')) ?? '{}');
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

  it('scanDirectory restores Noa-native identity from Markdown frontmatter without a manifest', async () => {
    const root = createMemRoot();
    await writeRawFile(root, 'Inbox/Native.md', [
      '---',
      'id: restored-note',
      'createdAt: 2026-04-09T12:00:00.000Z',
      'noaSource: noa',
      'tags:',
      '  - work',
      '---',
      'Body',
    ].join('\n'));

    const { notes, folders, newFolders, manifestIds } = await scanDirectory(asFsHandle(root), []);

    expect(manifestIds.size).toBe(0);
    expect(folders.map((folder) => folder.name)).toEqual(['Inbox']);
    expect(newFolders.map((folder) => folder.name)).toEqual(['Inbox']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: 'restored-note',
      title: 'Native',
      content: 'Body',
      createdAt: '2026-04-09T12:00:00.000Z',
      source: 'noa',
      tags: ['work'],
    });
    expect(notes[0].folder).toBe(folders[0].id);
  });

  it('scanDirectory reads Noa-owned attachment payloads from the vault', async () => {
    const root = createMemRoot();
    const noteId = '11111111-1111-4111-8111-111111111111';
    const attachmentId = '22222222-2222-4222-8222-222222222222';
    await writeRawFile(root, 'Native.md', [
      '---',
      `id: ${noteId}`,
      'createdAt: 2026-04-09T12:00:00.000Z',
      'noaSource: noa',
      '---',
      `![[attachments/${noteId}/${attachmentId}-photo.png]]`,
    ].join('\n'));
    await writeRawFile(root, `attachments/${noteId}/${attachmentId}-photo.png`, 'hello');

    const { notes } = await scanDirectory(asFsHandle(root), []);

    expect(notes[0].attachments).toHaveLength(1);
    expect(notes[0].attachments?.[0]).toMatchObject({
      id: attachmentId,
      noteId,
      filename: 'photo.png',
      size: 5,
      dataBase64: 'aGVsbG8=',
      vaultPath: `attachments/${noteId}/${attachmentId}-photo.png`,
    });
  });

  it('scanDirectory returns the current vault folder tree without stale cached folders', async () => {
    const root = createMemRoot();
    const staleFolders = [
      { id: 'old', name: 'Old Folder', source: 'obsidian-import' as const },
      { id: 'keep', name: 'Keep Folder', source: 'obsidian-import' as const },
    ];
    await writeRawFile(root, 'Keep Folder/Note.md', 'Body');

    const { folders, newFolders } = await scanDirectory(asFsHandle(root), staleFolders);

    expect(folders.map((folder) => folder.name)).toEqual(['Keep Folder']);
    expect(folders[0].id).toBe('keep');
    expect(newFolders).toEqual([]);
  });

  it('mergeScannedNotes uses the current vault folder tree in authoritative mode', async () => {
    const root = createMemRoot();
    const staleFolders = [
      { id: 'old', name: 'Old Folder', source: 'obsidian-import' as const },
      { id: 'keep', name: 'Keep Folder', source: 'obsidian-import' as const },
    ];
    const localNote = makeNote({ id: 'local-only', folder: 'old' });
    await writeRawFile(root, 'Keep Folder/Note.md', 'Body');

    const result = await mergeScannedNotes(
      asFsHandle(root),
      [localNote],
      staleFolders,
      { mode: 'vault-authoritative' },
    );

    expect(result.folders.map((folder) => folder.name)).toEqual(['Keep Folder']);
    // local-only was never manifest-tracked → kept for the next full sync.
    expect(result.deletedNoteIds).toEqual([]);
    expect(result.notes).toHaveLength(2);
    expect(result.notes.some((n) => n.id === 'local-only')).toBe(true);
    expect(result.notes.find((n) => n.id !== 'local-only')?.folder).toBe('keep');
  });
});

describe('mergeScannedNotes with pending debounced writes', () => {
  it('flushes a pending debounced note write before scanning so authoritative merge keeps the latest edit', async () => {
    const root = createMemRoot();
    const note = makeNote({ id: 'a1a1a1a1-0000-4000-8000-0000000000f1', source: 'noa', content: 'old content' });
    await writeNote(asFsHandle(root), note, []);

    // Simulate a keystroke mid-debounce: disk still holds the old content.
    const pending = syncNoteUpdate(asFsHandle(root), note, 'fresh edit', []);

    const { notes } = await mergeScannedNotes(
      asFsHandle(root),
      [{ ...note, content: 'fresh edit' }],
      [],
      { mode: 'vault-authoritative' },
    );
    await pending;

    expect(notes.find((n) => n.id === note.id)?.content).toBe('fresh edit');
  });
});

describe('folder lifecycle on disk', () => {
  it('syncFolderCreate creates the directory so authoritative scans keep empty folders', async () => {
    const root = createMemRoot();
    await syncFolderCreate(asFsHandle(root), 'Projects/Ideas');

    const dir = resolvePath(root, 'Projects/Ideas');
    expect(dir?.kind).toBe('directory');
  });

  it('syncFolderRename creates the new directory for an empty folder', async () => {
    const root = createMemRoot();
    await root.getDirectoryHandle('Old Name', { create: true });
    const folders = [{ id: 'f1', name: 'New Name' }];

    await syncFolderRename(asFsHandle(root), 'f1', 'Old Name', folders, []);

    expect(resolvePath(root, 'New Name')?.kind).toBe('directory');
    expect(resolvePath(root, 'Old Name')).toBeNull();
  });

  it('syncFolderDelete removes the empty directory so scans do not resurrect the folder', async () => {
    const root = createMemRoot();
    await root.getDirectoryHandle('Trashed', { create: true });

    await syncFolderDelete(asFsHandle(root), 'Trashed');

    expect(resolvePath(root, 'Trashed')).toBeNull();
  });

  it('syncFolderDelete keeps directories that still contain untracked files', async () => {
    const root = createMemRoot();
    await writeRawFile(root, 'Keep/untracked.pdf', 'binary');

    await syncFolderDelete(asFsHandle(root), 'Keep');

    expect(resolvePath(root, 'Keep/untracked.pdf')?.kind).toBe('file');
  });
});

describe('vault manifest location and hidden entries', () => {
  it('writes the manifest into .noa/ instead of the vault root', async () => {
    const root = createMemRoot();
    await writeNote(asFsHandle(root), makeNote(), []);

    expect(resolvePath(root, '.noa/manifest.json')?.kind).toBe('file');
    expect(resolvePath(root, 'manifest.json')).toBeNull();
  });

  it('reads a legacy root manifest.json and removes it on the next write', async () => {
    const root = createMemRoot();
    const note = makeNote({ id: 'a1a1a1a1-0000-4000-8000-0000000000a3' });
    await writeRawFile(root, 'Sample.md', 'legacy body');
    await writeRawFile(root, 'manifest.json', JSON.stringify({
      version: 1,
      notes: { 'Sample.md': { id: note.id, createdAt: note.createdAt, source: 'noa' } },
    }));

    const scan = await scanDirectory(asFsHandle(root), []);
    expect(scan.notes.map((n) => n.id)).toEqual([note.id]);

    await writeNote(asFsHandle(root), note, []);
    expect(resolvePath(root, '.noa/manifest.json')?.kind).toBe('file');
    expect(resolvePath(root, 'manifest.json')).toBeNull();
  });

  it('ignores dot-directories like .noa during scans', async () => {
    const root = createMemRoot();
    await writeRawFile(root, '.noa/not-a-note.md', 'internal');

    const { notes, folders } = await scanDirectory(asFsHandle(root), []);

    expect(notes).toHaveLength(0);
    expect(folders).toHaveLength(0);
  });

  it('treats a root README.md as a normal note like Obsidian does', async () => {
    const root = createMemRoot();
    await writeRawFile(root, 'README.md', 'vault readme');

    const { notes } = await scanDirectory(asFsHandle(root), []);
    expect(notes.map((n) => n.title)).toEqual(['README']);

    const stats = await scanNoteFileStats(asFsHandle(root));
    expect([...stats.keys()]).toEqual(['README.md']);
  });
});

describe('writeNote churn avoidance', () => {
  it('keeps mtime of note file and manifest when nothing changed', async () => {
    const root = createMemRoot();
    const n = makeNote({ id: 'a1a1a1a1-0000-4000-8000-0000000000c7', source: 'noa' as const });

    const first = await writeNote(asFsHandle(root), n, []);
    const manifestBefore = await (resolvePath(root, '.noa/manifest.json') as { getFile(): Promise<File> }).getFile();
    await new Promise((r) => setTimeout(r, 10));

    const second = await writeNote(asFsHandle(root), n, []);
    const manifestAfter = await (resolvePath(root, '.noa/manifest.json') as { getFile(): Promise<File> }).getFile();

    expect(second?.path).toBe(first?.path);
    expect(second?.lastModified).toBe(first?.lastModified);
    expect(manifestAfter.lastModified).toBe(manifestBefore.lastModified);
  });
});
