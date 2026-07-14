import { describe, expect, it } from 'vitest';
import { deleteNoteFile, getVaultIdentity, scanDirectory, scanNoteFileStats, writeNote } from '../../src/lib/fileSystemStorage';
import { mergeScannedNotes, replayVaultPendingOperation, syncFolderDelete, syncFolderRename, syncNoteDelete, syncNoteMove, syncNoteRename, syncNoteUpdate, syncVaultNoteSnapshot } from '../../src/services/fileSyncService';
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
  // Notes written to disk are vault-origin by definition; kept-local tests
  // override this to undefined to model a Noa-owned note.
  origin: 'vault',
  ...overrides,
});

// Cast helper: the mock implements the subset of FileSystemDirectoryHandle
// that fileSystemStorage actually touches.
const asFsHandle = (root: ReturnType<typeof createMemRoot>) =>
  root as unknown as FileSystemDirectoryHandle;

describe('vault identity', () => {
  it('persists one identity per vault root', async () => {
    const first = asFsHandle(createMemRoot());
    const second = asFsHandle(createMemRoot());

    const firstId = await getVaultIdentity(first);
    expect(await getVaultIdentity(first)).toBe(firstId);
    expect(await getVaultIdentity(second)).not.toBe(firstId);
  });
});

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

  it('does not fall back to an unrelated title match when an exact vaultPath is known', async () => {
    const root = createMemRoot();
    await writeRawFile(root, 'Existing.md', 'user-owned body');
    const stale = makeNote({
      id: 'stale-note',
      title: 'Existing',
      vaultPath: 'Missing.md',
    });

    const removed = await deleteNoteFile(asFsHandle(root), stale, []);

    expect(removed).toBeNull();
    expect(await readFileText(root, 'Existing.md')).toBe('user-owned body');
  });
});

describe('syncNoteRename', () => {
  it('flushes a pending content update before renaming so the old path cannot reappear', async () => {
    const root = createMemRoot();
    const note = makeNote({ content: 'old content' });
    await writeNote(asFsHandle(root), note, []);

    const pendingUpdate = syncNoteUpdate(asFsHandle(root), note, 'latest content', []);
    await syncNoteRename(asFsHandle(root), { ...note, content: 'latest content' }, 'Renamed', []);
    await pendingUpdate;

    expect(resolvePath(root, 'Sample.md')).toBeNull();
    expect(await readFileText(root, 'Renamed.md')).toBe('latest content');
  });

  it('cancels a pending content update when deletion supersedes it', async () => {
    const root = createMemRoot();
    const note = makeNote({ content: 'old content' });
    await writeNote(asFsHandle(root), note, []);

    const pendingUpdate = syncNoteUpdate(asFsHandle(root), note, 'late content', []);
    await syncNoteDelete(asFsHandle(root), note, []);
    await pendingUpdate;

    expect(resolvePath(root, 'Sample.md')).toBeNull();
  });

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

  it('does not overwrite an unmanaged vault file with the requested target title', async () => {
    const root = createMemRoot();
    const note = makeNote({ title: 'Original', content: 'managed body' });
    await writeNote(asFsHandle(root), note, []);
    await writeRawFile(root, 'Existing.md', 'user-owned body');

    await syncNoteRename(asFsHandle(root), note, 'Existing', []);

    expect(await readFileText(root, 'Existing.md')).toBe('user-owned body');
    expect(resolvePath(root, 'Original.md')).toBeNull();
    const managedPath = listPaths(root).find((path) => /^Existing_[0-9a-f]{8}\.md$/.test(path));
    expect(managedPath).toBeDefined();
    expect(await readFileText(root, managedPath as string)).toBe('managed body');
  });
});

describe('syncVaultNoteSnapshot', () => {
  it('writes the latest dirty snapshot and removes the obsolete vault path', async () => {
    const root = createMemRoot();
    const original = makeNote({ title: 'Old title', content: 'old content' });
    await writeNote(asFsHandle(root), original, []);

    const recovered = {
      ...original,
      title: 'Recovered title',
      content: 'latest local edit',
      vaultPath: 'Old title.md',
      vaultDirty: true,
    };
    await syncVaultNoteSnapshot(asFsHandle(root), recovered, []);

    expect(resolvePath(root, 'Old title.md')).toBeNull();
    expect(await readFileText(root, 'Recovered title.md')).toBe('latest local edit');
  });
});

describe('replayVaultPendingOperation', () => {
  it('replays a persisted note-delete tombstone after the local row is gone', async () => {
    const root = createMemRoot();
    const deleted = makeNote({ title: 'Delete me' });
    await writeNote(asFsHandle(root), deleted, []);

    await replayVaultPendingOperation(asFsHandle(root), {
      key: 'delete-note:1',
      entityKey: `note:${deleted.id}`,
      kind: 'delete-note',
      note: deleted,
      folders: [],
    }, []);

    expect(resolvePath(root, 'Delete me.md')).toBeNull();
  });

  it('replays a persisted folder rename using the desired folder snapshot', async () => {
    const root = createMemRoot();
    const folderId = 'folder-1';
    const originalFolders = [{ id: folderId, name: 'Old', origin: 'vault' as const }];
    const nextFolders = [{ id: folderId, name: 'New', origin: 'vault' as const }];
    const moved = makeNote({ folder: folderId, title: 'Inside' });
    await writeNote(asFsHandle(root), moved, originalFolders);

    await replayVaultPendingOperation(asFsHandle(root), {
      key: 'rename-folder:1',
      entityKey: `folder:${folderId}`,
      kind: 'rename-folder',
      folderId,
      previousName: 'Old',
      nextFolders,
    }, [moved]);

    expect(resolvePath(root, 'Old/Inside.md')).toBeNull();
    expect(await readFileText(root, 'New/Inside.md')).toBe('# Sample');

    const finalFolders = [{ id: folderId, name: 'Final', origin: 'vault' as const }];
    await replayVaultPendingOperation(asFsHandle(root), {
      key: 'rename-folder:2',
      entityKey: `folder:${folderId}`,
      kind: 'rename-folder',
      folderId,
      previousName: 'New',
      nextFolders: finalFolders,
    }, [moved]);

    expect(resolvePath(root, 'New/Inside.md')).toBeNull();
    expect(await readFileText(root, 'Final/Inside.md')).toBe('# Sample');
  });
});

describe('syncFolderRename', () => {
  const folderId = 'f1f1f1f1-0000-4000-8000-00000000000f';

  it('moves managed notes but preserves files Noa does not track', async () => {
    const root = createMemRoot();
    const oldFolders = [{ id: folderId, name: 'Old Folder', source: 'obsidian-import' as const, origin: 'vault' as const }];
    const note = makeNote({ folder: folderId, content: 'managed note' });
    await writeNote(asFsHandle(root), note, oldFolders);

    // An untracked vault file living in the same folder (e.g. a PDF kept in Obsidian).
    const oldDir = resolvePath(root, 'Old Folder');
    expect(oldDir?.kind).toBe('directory');
    await (oldDir as ReturnType<typeof createMemRoot>).getFileHandle('reference.pdf', { create: true });

    const newFolders = [{ id: folderId, name: 'New Folder', source: 'obsidian-import' as const, origin: 'vault' as const }];
    await syncFolderRename(asFsHandle(root), folderId, 'Old Folder', newFolders, [note]);

    // Managed note moved to the renamed directory.
    expect(await readFileText(root, 'New Folder/Sample.md')).toBe('managed note');
    expect(resolvePath(root, 'Old Folder/Sample.md')).toBeNull();
    // Untracked file must survive in place.
    expect(resolvePath(root, 'Old Folder/reference.pdf')).not.toBeNull();
  });

  it('removes the old directory tree when it only contained managed notes', async () => {
    const root = createMemRoot();
    const oldFolders = [{ id: folderId, name: 'Old Folder', source: 'obsidian-import' as const, origin: 'vault' as const }];
    const note = makeNote({ folder: folderId, content: 'managed note' });
    await writeNote(asFsHandle(root), note, oldFolders);

    const newFolders = [{ id: folderId, name: 'New Folder', source: 'obsidian-import' as const, origin: 'vault' as const }];
    await syncFolderRename(asFsHandle(root), folderId, 'Old Folder', newFolders, [note]);

    expect(await readFileText(root, 'New Folder/Sample.md')).toBe('managed note');
    expect(resolvePath(root, 'Old Folder')).toBeNull();
  });

  it('moves notes in nested subfolders and keeps untracked nested files', async () => {
    const root = createMemRoot();
    const childId = 'c1c1c1c1-0000-4000-8000-00000000000c';
    const oldFolders = [
      { id: folderId, name: 'Old Folder', source: 'obsidian-import' as const, origin: 'vault' as const },
      { id: childId, name: 'Old Folder/Child', source: 'obsidian-import' as const, origin: 'vault' as const },
    ];
    const nested = makeNote({ id: 'd4d4d4d4-0000-4000-8000-000000000004', folder: childId, content: 'nested note' });
    await writeNote(asFsHandle(root), nested, oldFolders);
    const childDir = resolvePath(root, 'Old Folder/Child');
    await (childDir as ReturnType<typeof createMemRoot>).getFileHandle('drawing.canvas', { create: true });

    const newFolders = [
      { id: folderId, name: 'New Folder', source: 'obsidian-import' as const, origin: 'vault' as const },
      { id: childId, name: 'New Folder/Child', source: 'obsidian-import' as const, origin: 'vault' as const },
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
    const folders = [{ id: 'f1', name: 'My Notes', source: 'obsidian-import' as const, origin: 'vault' as const }];
    await writeNote(asFsHandle(root), makeNote({ folder: 'f1' }), folders);

    expect(await readFileText(root, 'My Notes/Sample.md')).toBe('# Sample');
    const manifest = JSON.parse((await readFileText(root, '.noa/manifest.json')) ?? '{}');
    expect(Object.keys(manifest.notes)).toEqual(['My Notes/Sample.md']);
  });

  it('scanDirectory reuses existing folders whose names contain spaces', async () => {
    const root = createMemRoot();
    const folders = [{ id: 'f1', name: 'My Notes', source: 'obsidian-import' as const, origin: 'vault' as const }];
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

  it('scanDirectory skips re-reading attachment payloads whose blobs are already in storage', async () => {
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

    const { notes } = await scanDirectory(asFsHandle(root), [], {
      existingAttachmentBlobIds: new Set([attachmentId]),
    });

    const attachment = notes[0].attachments?.[0];
    expect(attachment?.dataBase64).toBeUndefined();
    expect(attachment).toMatchObject({
      id: attachmentId,
      noteId,
      filename: 'photo.png',
      size: 5,
      vaultPath: `attachments/${noteId}/${attachmentId}-photo.png`,
    });
  });

  it('scanDirectory returns the current vault folder tree without stale cached folders', async () => {
    const root = createMemRoot();
    const staleFolders = [
      { id: 'old', name: 'Old Folder', source: 'obsidian-import' as const, origin: 'vault' as const },
      { id: 'keep', name: 'Keep Folder', source: 'obsidian-import' as const, origin: 'vault' as const },
    ];
    await writeRawFile(root, 'Keep Folder/Note.md', 'Body');

    const { folders, newFolders } = await scanDirectory(asFsHandle(root), staleFolders);

    expect(folders.map((folder) => folder.name)).toEqual(['Keep Folder']);
    expect(folders[0].id).toBe('keep');
    expect(newFolders).toEqual([]);
  });

  it('mergeScannedNotes drops stale cached folders no surviving note references', async () => {
    const root = createMemRoot();
    const staleFolders = [
      { id: 'old', name: 'Old Folder', source: 'obsidian-import' as const, origin: 'vault' as const },
      { id: 'keep', name: 'Keep Folder', source: 'obsidian-import' as const, origin: 'vault' as const },
    ];
    const localNote = makeNote({ id: 'local-only', folder: '', origin: undefined });
    await writeRawFile(root, 'Keep Folder/Note.md', 'Body');

    const result = await mergeScannedNotes(
      asFsHandle(root),
      [localNote],
      staleFolders,
      { mode: 'vault-authoritative' },
    );

    expect(result.folders.map((folder) => folder.name)).toEqual(['Keep Folder']);
    // local-only is Noa-owned, so an authoritative vault refresh leaves it alone.
    expect(result.deletedNoteIds).toEqual([]);
    expect(result.notes).toHaveLength(2);
    expect(result.notes.some((n) => n.id === 'local-only')).toBe(true);
    expect(result.notes.find((n) => n.id !== 'local-only')?.folder).toBe('keep');
  });

  it('mergeScannedNotes keeps local folders that kept-local notes still reference', async () => {
    const root = createMemRoot();
    await writeRawFile(root, 'Vault Folder/Disk.md', 'disk note');
    const localFolders = [
      { id: 'lf-parent', name: 'Local' },
      { id: 'lf-child', name: 'Local/Drafts' },
    ];
    const localNote = makeNote({ id: 'local-note', folder: 'lf-child', source: 'noa', origin: undefined });

    const result = await mergeScannedNotes(
      asFsHandle(root),
      [localNote],
      localFolders,
      { mode: 'vault-authoritative' },
    );

    // The kept-local note survives, so its folder chain (including ancestors)
    // must survive too — otherwise the cache would reference missing folder ids.
    expect(result.notes.some((n) => n.id === 'local-note')).toBe(true);
    expect(result.folders.map((folder) => folder.name).sort()).toEqual([
      'Local',
      'Local/Drafts',
      'Vault Folder',
    ]);
  });

  it('preserves empty Noa folders during a non-empty vault refresh', async () => {
    const root = createMemRoot();
    await writeRawFile(root, 'Vault Folder/Disk.md', 'disk note');
    const localFolders = [{ id: 'empty-local', name: 'Empty Local', source: 'noa' as const }];

    const result = await mergeScannedNotes(
      asFsHandle(root),
      [],
      localFolders,
      { mode: 'vault-authoritative' },
    );

    expect(result.folders.map((folder) => folder.name).sort()).toEqual(['Empty Local', 'Vault Folder']);
  });

  it('drops stale vault folders from an empty vault but keeps Noa folders', async () => {
    const root = createMemRoot();
    const folders = [
      { id: 'local', name: 'Local', source: 'noa' as const },
      { id: 'stale-vault', name: 'Gone', origin: 'vault' as const },
    ];

    const result = await mergeScannedNotes(
      asFsHandle(root),
      [],
      folders,
      { mode: 'vault-authoritative' },
    );

    expect(result.folders).toEqual([folders[0]]);
  });

  it('does not reuse a Noa-owned folder id for a same-named vault directory', async () => {
    const root = createMemRoot();
    await writeRawFile(root, 'Projects/Disk.md', 'disk note');
    const localFolder = { id: 'local-projects', name: 'Projects', source: 'noa' as const };

    const result = await mergeScannedNotes(
      asFsHandle(root),
      [makeNote({ id: 'local-note', folder: 'local-projects', source: 'noa', origin: undefined })],
      [localFolder],
      { mode: 'vault-authoritative' },
    );

    const sameNamed = result.folders.filter((folder) => folder.name === 'Projects');
    expect(sameNamed).toHaveLength(2);
    expect(sameNamed).toContainEqual(localFolder);
    expect(sameNamed.some((folder) => folder.id !== localFolder.id && folder.origin === 'vault')).toBe(true);
    expect(result.notes.find((note) => note.id === 'local-note')?.folder).toBe(localFolder.id);
    expect(result.notes.find((note) => note.id !== 'local-note')?.folder).not.toBe(localFolder.id);
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
  it('syncFolderRename creates the new directory for an empty folder', async () => {
    const root = createMemRoot();
    await root.getDirectoryHandle('Old Name', { create: true });
    const folders = [{ id: 'f1', name: 'New Name', origin: 'vault' as const }];

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

describe('vault origin marking and write guard', () => {
  it('marks scanned notes and folders as vault-origin', async () => {
    const root = createMemRoot();
    await writeRawFile(root, 'Projects/Idea.md', 'body');

    const { notes, folders } = await scanDirectory(asFsHandle(root), []);

    expect(notes[0].origin).toBe('vault');
    expect(notes[0].vaultPath).toBe('Projects/Idea.md');
    expect(folders.every((folder) => folder.origin === 'vault')).toBe(true);
  });

  it('marks newly-discovered vault folders as vault-origin', async () => {
    const root = createMemRoot();
    await writeRawFile(root, 'Fresh/Note.md', 'body');

    const { newFolders } = await scanDirectory(asFsHandle(root), []);

    expect(newFolders.length).toBeGreaterThan(0);
    expect(newFolders.every((folder) => folder.origin === 'vault')).toBe(true);
  });

  it('refuses to write a note that is not vault-origin (defense in depth)', async () => {
    const root = createMemRoot();
    // A Noa-owned note (no origin marker) must never reach the vault, even if a
    // stray caller invokes writeNote directly.
    const noaNote = makeNote({ id: 'noa-only', origin: undefined, content: 'private' });

    const result = await writeNote(asFsHandle(root), noaNote, []);

    expect(result).toBeNull();
    expect(resolvePath(root, 'Sample.md')).toBeNull();
    expect(resolvePath(root, '.noa/manifest.json')).toBeNull();
  });

  it('refuses to write a vault note into a Noa-owned folder', async () => {
    const root = createMemRoot();
    const note = makeNote({ folder: 'local-folder' });
    const localFolders = [{ id: 'local-folder', name: 'Private', source: 'noa' as const }];

    const result = await writeNote(asFsHandle(root), note, localFolders);

    expect(result).toBeNull();
    expect(resolvePath(root, 'Private/Sample.md')).toBeNull();
    expect(resolvePath(root, '.noa/manifest.json')).toBeNull();
  });

  it('refuses a structural move from the vault into a Noa-owned folder', async () => {
    const root = createMemRoot();
    const note = makeNote({ content: 'stay in vault' });
    await writeNote(asFsHandle(root), note, []);
    const localFolders = [{ id: 'local-folder', name: 'Private', source: 'noa' as const }];

    await syncNoteMove(
      asFsHandle(root),
      note,
      { ...note, folder: 'local-folder' },
      localFolders,
    );

    expect(await readFileText(root, 'Sample.md')).toBe('stay in vault');
    expect(resolvePath(root, 'Private/Sample.md')).toBeNull();
  });

  it('uses vaultId rather than the namespaced cache id for disk identity', async () => {
    const root = createMemRoot();
    const note = makeNote({
      id: 'vault:shared-id',
      vaultId: 'shared-id',
      source: 'noa',
      content: 'body',
    });

    await writeNote(asFsHandle(root), note, []);

    expect(await readFileText(root, 'Sample.md')).toContain('id: shared-id');
    expect(await readFileText(root, 'Sample.md')).not.toContain('id: vault:shared-id');
    const manifest = JSON.parse((await readFileText(root, '.noa/manifest.json')) ?? '{}');
    expect(manifest.notes['Sample.md']?.id).toBe('shared-id');
  });
});

describe('vault files stay untouched on first connect', () => {
  it('registers a manifest entry without rewriting a byte-identical obsidian file', async () => {
    const root = createMemRoot();
    const original = [
      '---',
      'id: 20240101',
      'links: [projects/alpha]',
      'aliases:',
      '  - Alpha',
      '---',
      'Body with ![[ spaced embed ]] and [[Other Note]]',
    ].join('\n');
    await writeRawFile(root, 'Alpha.md', original);
    await new Promise((r) => setTimeout(r, 10));

    const { notes } = await scanDirectory(asFsHandle(root), []);
    expect(notes).toHaveLength(1);
    const fileBefore = await (resolvePath(root, 'Alpha.md') as { getFile(): Promise<File> }).getFile();

    const written = await writeNote(asFsHandle(root), notes[0], []);

    expect(await readFileText(root, 'Alpha.md')).toBe(original);
    const fileAfter = await (resolvePath(root, 'Alpha.md') as { getFile(): Promise<File> }).getFile();
    expect(fileAfter.lastModified).toBe(fileBefore.lastModified);
    expect(written?.path).toBe('Alpha.md');
    const manifest = JSON.parse((await readFileText(root, '.noa/manifest.json')) ?? '{}');
    expect(manifest.notes['Alpha.md']?.id).toBe(notes[0].id);
  });

  it('keeps CRLF files byte-identical through scan and write-back', async () => {
    const root = createMemRoot();
    const original = '---\r\ntitle: Keep\r\ncreated: 2026-04-05\r\n---\r\nline one\r\nline two';
    await writeRawFile(root, 'Windows.md', original);

    const { notes } = await scanDirectory(asFsHandle(root), []);
    await writeNote(asFsHandle(root), notes[0], []);

    expect(await readFileText(root, 'Windows.md')).toBe(original);
  });

  it('keeps one-line CRLF frontmatter byte-identical through scan and write-back', async () => {
    const root = createMemRoot();
    const original = '---\r\ntitle: Keep\r\n---\r\nbody';
    await writeRawFile(root, 'Windows.md', original);

    const { notes } = await scanDirectory(asFsHandle(root), []);
    await writeNote(asFsHandle(root), notes[0], []);

    expect(await readFileText(root, 'Windows.md')).toBe(original);
  });

  it('does not adopt a user frontmatter id: as note identity', async () => {
    const root = createMemRoot();
    const withUserId = (body: string) => ['---', 'id: 123', '---', body].join('\n');
    await writeRawFile(root, 'One.md', withUserId('one'));
    await writeRawFile(root, 'Two.md', withUserId('two'));

    const { notes } = await scanDirectory(asFsHandle(root), []);

    // A user's own id: field (common in Zettelkasten templates) must not become
    // the note id — template-duplicated ids would collapse distinct notes.
    expect(notes).toHaveLength(2);
    expect(notes.every((n) => n.id !== '123')).toBe(true);
    expect(new Set(notes.map((n) => n.id)).size).toBe(2);
  });
});

describe('scan title collision-suffix stripping', () => {
  it('strips the suffix only when it mirrors the owning note id', async () => {
    const root = createMemRoot();
    const noteA = makeNote({ id: 'a1a1a1a1-0000-4000-8000-000000000001', content: 'note A' });
    const noteB = makeNote({ id: 'b2b2b2b2-0000-4000-8000-000000000002', content: 'note B' });
    await writeNote(asFsHandle(root), noteA, []);
    await writeNote(asFsHandle(root), noteB, []); // collision → Sample_b2b2b2b2.md

    const { notes } = await scanDirectory(asFsHandle(root), []);

    expect(notes.map((n) => n.title).sort()).toEqual(['Sample', 'Sample']);
  });

  it('keeps date-like suffixes in user filenames', async () => {
    const root = createMemRoot();
    await writeRawFile(root, 'journal_20240115.md', 'daily entry');

    const { notes } = await scanDirectory(asFsHandle(root), []);

    expect(notes[0].title).toBe('journal_20240115');
  });

  it('round-trips collision suffixes for non-UUID vault ids', async () => {
    const root = createMemRoot();
    const noteA = makeNote({ id: 'restored-note-a', content: 'note A' });
    const noteB = makeNote({ id: 'restored-note-b', content: 'note B' });
    await writeNote(asFsHandle(root), noteA, []);
    await writeNote(asFsHandle(root), noteB, []);

    const { notes } = await scanDirectory(asFsHandle(root), []);

    expect(notes.map((note) => note.title).sort()).toEqual(['Sample', 'Sample']);
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
