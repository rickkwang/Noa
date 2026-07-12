import { describe, it, expect } from 'vitest';
import { createMemRoot } from './helpers/memfs';
import {
  analyzeConflicts,
  applyImportStrategy,
  buildVaultImportPayload,
  collectVaultDirectoryEntries,
  classifyFolderImportFile,
  countImportedNotes,
  getFolderImportPath,
  prepareImportedNotes,
  parseZipAttachmentPath,
  resolveImportedFolders,
  resolveImportedWorkspaceName,
  uniqueExportFilename,
  validateAttachmentPayloads,
  zipAttachmentPath,
} from '../../src/hooks/useDataTransfer';
import { Note } from '../../src/types';
import {
  selectNoaOwnedWorkspace,
  stripVaultMetadataFromImportedFolders,
} from '../../src/lib/workspaceOwnership';

const makeNote = (id: string, title: string): Note => ({
  id,
  title,
  content: '',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
});

describe('selectNoaOwnedWorkspace', () => {
  it('excludes vault cache rows but preserves ordinary one-time imports', () => {
    const local = makeNote('local', 'Local');
    const imported = { ...makeNote('imported', 'Imported'), source: 'obsidian-import' as const };
    const vault = {
      ...makeNote('vault:external', 'Vault'),
      source: 'obsidian-import' as const,
      origin: 'vault' as const,
      vaultId: 'external',
      vaultPath: 'Vault.md',
    };
    const localFolder = { id: 'local-folder', name: 'Local' };
    const importedFolder = { id: 'imported-folder', name: 'Imported', source: 'obsidian-import' as const };
    const vaultFolder = {
      id: 'vault:folder',
      name: 'Vault folder',
      origin: 'vault' as const,
      vaultPath: 'Projects',
    };
    const notes = [local, imported, vault];
    const folders = [localFolder, importedFolder, vaultFolder];

    const selected = selectNoaOwnedWorkspace(notes, folders);

    expect(selected.notes).toEqual([local, imported]);
    expect(selected.folders).toEqual([localFolder, importedFolder]);
    expect(selected.notes[0]).toBe(local);
    expect(selected.folders[0]).toBe(localFolder);
    expect(notes).toEqual([local, imported, vault]);
    expect(folders).toEqual([localFolder, importedFolder, vaultFolder]);
  });

  it('strips vault ownership metadata from externally imported folders', () => {
    const importedFolders = [{
      id: 'external-folder',
      name: 'External',
      source: 'obsidian-import' as const,
      origin: 'vault' as const,
      vaultPath: 'External',
    }];

    expect(stripVaultMetadataFromImportedFolders(importedFolders)).toEqual([{
      id: 'external-folder',
      name: 'External',
      source: 'obsidian-import',
    }]);
    expect(importedFolders[0]).toMatchObject({ origin: 'vault', vaultPath: 'External' });
  });
});

describe('analyzeConflicts', () => {
  const existing = [makeNote('id1', 'Note A'), makeNote('id2', 'Note B')];

  it('counts same-id conflicts', () => {
    const incoming = [makeNote('id1', 'Note A Renamed')];
    const summary = analyzeConflicts(incoming, existing);
    expect(summary.sameIdCount).toBe(1);
    expect(summary.newCount).toBe(0);
  });

  it('counts duplicate title conflicts', () => {
    const incoming = [makeNote('id99', 'Note A')];
    const summary = analyzeConflicts(incoming, existing);
    expect(summary.dupeTitleCount).toBe(1);
    expect(summary.sameIdCount).toBe(0);
  });

  it('counts new notes', () => {
    const incoming = [makeNote('id99', 'Brand New Note')];
    const summary = analyzeConflicts(incoming, existing);
    expect(summary.newCount).toBe(1);
  });

  it('handles empty incoming', () => {
    const summary = analyzeConflicts([], existing);
    expect(summary.sameIdCount).toBe(0);
    expect(summary.dupeTitleCount).toBe(0);
    expect(summary.newCount).toBe(0);
  });
});

describe('applyImportStrategy', () => {
  const existing = [makeNote('id1', 'Note A'), makeNote('id2', 'Note B')];
  const incoming = [makeNote('id1', 'Note A Updated'), makeNote('id3', 'Note C')];

  it('overwrite: returns only incoming notes', () => {
    const result = applyImportStrategy(incoming, existing, 'overwrite');
    expect(result).toHaveLength(2);
    expect(result.map(n => n.id)).toEqual(['id1', 'id3']);
  });

  it('skip: keeps existing and appends truly new notes', () => {
    const result = applyImportStrategy(incoming, existing, 'skip');
    expect(result).toHaveLength(3); // id1(existing), id2, id3
    expect(result.find(n => n.id === 'id1')?.title).toBe('Note A'); // original kept
    expect(result.some(n => n.id === 'id3')).toBe(true);
  });

  it('merge: conflicting id gets renamed, new note appended', () => {
    const result = applyImportStrategy(incoming, existing, 'merge');
    expect(result.length).toBe(4); // id1, id2, id1-renamed, id3
    const renamed = result.find(n => n.title === 'Note A Updated (imported)');
    expect(renamed).toBeDefined();
    expect(renamed?.id).not.toBe('id1'); // new uuid assigned
    expect(result.some(n => n.id === 'id3')).toBe(true);
  });

  it('skip: no change when all incoming ids already exist', () => {
    const allExisting = [makeNote('id1', 'Note A Updated')];
    const result = applyImportStrategy(allExisting, existing, 'skip');
    expect(result).toHaveLength(2);
  });

  it('skip: skips duplicate titles even with different ids', () => {
    const duplicateTitle = [makeNote('id99', 'Note A')];
    const result = applyImportStrategy(duplicateTitle, existing, 'skip');
    expect(result).toHaveLength(2);
    expect(result.some(n => n.id === 'id99')).toBe(false);
  });

  it('merge: renames duplicate titles even when id is new', () => {
    const duplicateTitle = [makeNote('id99', 'Note A')];
    const result = applyImportStrategy(duplicateTitle, existing, 'merge');
    const imported = result.find((n) => n.id !== 'id1' && n.id !== 'id2');
    expect(imported?.title).toBe('Note A (imported)');
  });
});

describe('countImportedNotes', () => {
  const existing = [makeNote('id1', 'Note A'), makeNote('id2', 'Note B')];

  it('counts overwrite by final notes length', () => {
    const finalNotes = [makeNote('id3', 'New 1')];
    expect(countImportedNotes(finalNotes, existing, 'overwrite')).toBe(1);
  });

  it('counts skip by appended notes delta', () => {
    const incoming = [makeNote('id1', 'Note A Updated'), makeNote('id3', 'Note C')];
    const finalNotes = applyImportStrategy(incoming, existing, 'skip');
    expect(countImportedNotes(finalNotes, existing, 'skip')).toBe(1);
  });

  it('counts merge by merged growth (including renamed conflicts)', () => {
    const incoming = [makeNote('id1', 'Note A Updated'), makeNote('id99', 'Note B')];
    const finalNotes = applyImportStrategy(incoming, existing, 'merge');
    expect(countImportedNotes(finalNotes, existing, 'merge')).toBe(2);
  });
});

describe('prepareImportedNotes', () => {
  it('recomputes tags and links from content', () => {
    const imported = prepareImportedNotes([
      {
        ...makeNote('id1', 'Note A'),
        content: 'Check #work and [[Linked Note]]',
        tags: ['stale'],
        links: ['Old Link'],
      },
    ]);

    expect(imported[0]?.tags).toEqual(['work']);
    expect(imported[0]?.links).toEqual(['Linked Note']);
  });
});

describe('validateAttachmentPayloads', () => {
  it('rejects invalid attachment payloads before write', () => {
    const error = validateAttachmentPayloads([
      {
        ...makeNote('id1', 'Note A'),
        attachments: [
          {
            id: 'att-1',
            noteId: 'id1',
            filename: 'image.png',
            mimeType: 'image/png',
            size: 10,
            createdAt: '2024-01-01T00:00:00.000Z',
            dataBase64: 'not-base64!!',
          },
        ],
      } as any,
    ]);

    expect(error).toMatch(/attachment payload is invalid/i);
  });

  it('accepts a well-formed base64 attachment payload', () => {
    const error = validateAttachmentPayloads([
      {
        ...makeNote('id1', 'Note A'),
        attachments: [
          {
            id: 'att-1',
            noteId: 'id1',
            filename: 'image.png',
            mimeType: 'image/png',
            size: 5,
            createdAt: '2024-01-01T00:00:00.000Z',
            dataBase64: 'aGVsbG8=',
          },
        ],
      } as any,
    ]);

    expect(error).toBeNull();
  });
});

describe('folder import file classification', () => {
  it('treats markdown and other text-like files as notes', () => {
    expect(classifyFolderImportFile({ name: 'note.md', type: '' })).toEqual({ kind: 'text' });
    expect(classifyFolderImportFile({ name: 'data.json', type: 'application/json' })).toEqual({ kind: 'text' });
    expect(classifyFolderImportFile({ name: 'readme.txt', type: 'text/plain' })).toEqual({ kind: 'text' });
  });

  it('treats image files as attachments', () => {
    expect(classifyFolderImportFile({ name: 'diagram.svg', type: '' })).toEqual({ kind: 'attachment' });
    expect(classifyFolderImportFile({ name: 'photo.png', type: 'image/png' })).toEqual({ kind: 'attachment' });
  });

  it('rejects unsupported binary files', () => {
    expect(classifyFolderImportFile({ name: 'archive.zip', type: 'application/zip' })).toEqual({ kind: 'unsupported' });
  });
});

describe('getFolderImportPath', () => {
  it('preserves nested relative folder paths including the selected root', () => {
    expect(getFolderImportPath({ webkitRelativePath: 'Workspace/Research/notes/today.md' })).toBe('Workspace/Research/notes');
  });

  it('returns the root folder for root-level files', () => {
    expect(getFolderImportPath({ webkitRelativePath: 'Workspace/note.md' })).toBe('Workspace');
  });

  it('keeps the full subtree beneath the selected vault root', () => {
    expect(getFolderImportPath({ webkitRelativePath: 'MyVault/Projects/Noa/specs/plan.md' })).toBe('MyVault/Projects/Noa/specs');
  });
});

describe('buildVaultImportPayload', () => {
  it('associates referenced attachment files with the markdown note and stages blobs', async () => {
    const pngBytes = Uint8Array.from([137, 80, 78, 71]);
    const files = [
      {
        pathSegments: ['MyVault', 'Docs', 'guide.md'],
        file: new File(['# Guide\n\n![[../assets/pixel.png]]'], 'guide.md', { type: 'text/markdown' }),
      },
      {
        pathSegments: ['MyVault', 'assets', 'pixel.png'],
        file: new File([pngBytes], 'pixel.png', { type: 'image/png' }),
      },
    ];
    const folderIdByPath = new Map([
      ['MyVault', 'root-folder'],
      ['MyVault/Docs', 'docs-folder'],
      ['MyVault/assets', 'assets-folder'],
    ]);

    const result = await buildVaultImportPayload(files, folderIdByPath);

    expect(result.notes).toHaveLength(1);
    expect(result.stagedAttachments).toHaveLength(1);
    expect(result.notes[0]?.title).toBe('guide');
    expect(result.notes[0]?.attachments).toHaveLength(1);
    expect(result.notes[0]?.attachments?.[0]?.filename).toBe('pixel.png');
    expect(result.notes[0]?.attachments?.[0]?.vaultPath).toBe('../assets/pixel.png');
    expect(result.notes[0]?.folder).toBe('docs-folder');
  });

  it('preserves nested README notes and only skips root export artifacts upstream', async () => {
    const files = [
      {
        pathSegments: ['MyVault', 'Docs', 'README.md'],
        file: new File(['# Nested Readme\n\nkeep-me'], 'README.md', { type: 'text/markdown' }),
      },
    ];
    const folderIdByPath = new Map([
      ['MyVault', 'root-folder'],
      ['MyVault/Docs', 'docs-folder'],
    ]);

    const result = await buildVaultImportPayload(files, folderIdByPath);

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.title).toBe('README');
    expect(result.notes[0]?.folder).toBe('docs-folder');
    expect(result.notes[0]?.content).toContain('keep-me');
  });

  it('does not bind ambiguous basename-only references to multiple same-named attachments', async () => {
    const pngBytes = Uint8Array.from([137, 80, 78, 71]);
    const files = [
      {
        pathSegments: ['MyVault', 'Docs', 'guide.md'],
        file: new File(['# Guide\n\n![[image.png]]'], 'guide.md', { type: 'text/markdown' }),
      },
      {
        pathSegments: ['MyVault', 'assets-a', 'image.png'],
        file: new File([pngBytes], 'image.png', { type: 'image/png' }),
      },
      {
        pathSegments: ['MyVault', 'assets-b', 'image.png'],
        file: new File([pngBytes], 'image.png', { type: 'image/png' }),
      },
    ];
    const folderIdByPath = new Map([
      ['MyVault', 'root-folder'],
      ['MyVault/Docs', 'docs-folder'],
      ['MyVault/assets-a', 'assets-a-folder'],
      ['MyVault/assets-b', 'assets-b-folder'],
    ]);

    const result = await buildVaultImportPayload(files, folderIdByPath);
    const guide = result.notes.find((note) => note.title === 'guide');

    expect(guide).toBeDefined();
    expect(guide?.attachments ?? []).toHaveLength(0);
    expect(result.stagedAttachments).toHaveLength(2);
    expect(result.notes.filter((note) => note.title === 'image')).toHaveLength(2);
  });
});

describe('resolveImportedFolders', () => {
  const existing = [
    { id: 'f-existing', name: 'diaries', source: 'noa' as const },
    { id: 'f-shared', name: 'essays', source: 'noa' as const },
  ];
  const incoming = [
    { id: 'f-shared', name: 'essays (backup)', source: 'noa' as const },
    { id: 'f-new', name: 'projects', source: 'noa' as const },
  ];

  it('overwrite: replaces folders with the imported set', () => {
    expect(resolveImportedFolders('overwrite', existing, incoming)).toEqual(incoming);
  });

  it('merge: keeps every existing folder and appends only new incoming ids', () => {
    const result = resolveImportedFolders('merge', existing, incoming);
    expect(result.map((f) => f.id)).toEqual(['f-existing', 'f-shared', 'f-new']);
    // The existing folder wins on id conflicts — its name is not clobbered.
    expect(result.find((f) => f.id === 'f-shared')?.name).toBe('essays');
  });

  it('skip: behaves like merge for folders (existing data is preserved)', () => {
    const result = resolveImportedFolders('skip', existing, incoming);
    expect(result.map((f) => f.id)).toEqual(['f-existing', 'f-shared', 'f-new']);
  });

  it('merge with no incoming folders keeps existing folders intact', () => {
    expect(resolveImportedFolders('merge', existing, [])).toEqual(existing);
  });
});

describe('resolveImportedWorkspaceName', () => {
  it('overwrite: uses the backup workspace name', () => {
    expect(resolveImportedWorkspaceName('overwrite', 'Backup WS')).toBe('Backup WS');
  });

  it('overwrite: falls back when the backup name is missing or not a string', () => {
    expect(resolveImportedWorkspaceName('overwrite', undefined)).toBe('Imported Workspace');
    expect(resolveImportedWorkspaceName('overwrite', 42 as unknown as string)).toBe('Imported Workspace');
    expect(resolveImportedWorkspaceName('overwrite', '   ')).toBe('Imported Workspace');
  });

  it('merge/skip: keeps the current workspace name untouched', () => {
    expect(resolveImportedWorkspaceName('merge', 'Backup WS')).toBeUndefined();
    expect(resolveImportedWorkspaceName('skip', 'Backup WS')).toBeUndefined();
  });
});

describe('zip attachment paths', () => {
  const ATT_ID = '0f0f0f0f-1111-4222-8333-444455556666';
  const NOTE_ID = 'aaaa1111-2222-4333-8444-555566667777';

  it('builds vault-style paths that round-trip through the parser', () => {
    const path = zipAttachmentPath(NOTE_ID, { id: ATT_ID, filename: 'my-photo (1).png' });
    expect(path).toBe(`attachments/${NOTE_ID}/${ATT_ID}-my-photo (1).png`);
    expect(parseZipAttachmentPath(path)).toEqual({
      attachmentId: ATT_ID,
      filename: 'my-photo (1).png',
    });
  });

  it('parses dash-heavy filenames without truncating them', () => {
    const path = `attachments/${NOTE_ID}/${ATT_ID}-a-b-c-d-e-final.png`;
    expect(parseZipAttachmentPath(path)).toEqual({
      attachmentId: ATT_ID,
      filename: 'a-b-c-d-e-final.png',
    });
  });

  it('parses the legacy export layout attachments/{attachmentId}/{filename}', () => {
    expect(parseZipAttachmentPath(`attachments/${ATT_ID}/photo.png`)).toEqual({
      attachmentId: ATT_ID,
      filename: 'photo.png',
    });
  });

  it('rejects paths it cannot attribute to an attachment id', () => {
    expect(parseZipAttachmentPath('attachments/not-a-uuid/a-b-c-d-e.png')).toBeNull();
    expect(parseZipAttachmentPath('attachments/orphan.png')).toBeNull();
    expect(parseZipAttachmentPath('notes/whatever.md')).toBeNull();
  });
});

describe('prepareImportedNotes source handling', () => {
  it('preserves frontmatter-derived tags and links for obsidian-import notes', () => {
    const note: Note = {
      ...makeNote('id1', 'Imported'),
      source: 'obsidian-import',
      content: 'Body with #bodytag and [[Body Link]]',
      tags: ['frontmatter-tag'],
      links: ['Curated Link'],
    };

    const [prepared] = prepareImportedNotes([note]);

    expect(prepared.tags).toEqual(['frontmatter-tag']);
    expect(prepared.links).toEqual(['Curated Link']);
  });

  it('still re-extracts tags and links for noa-native notes', () => {
    const note: Note = {
      ...makeNote('id2', 'Native'),
      source: 'noa',
      content: 'Body with #bodytag and [[Body Link]]',
      tags: ['stale-tag'],
      links: ['Stale Link'],
    };

    const [prepared] = prepareImportedNotes([note]);

    expect(prepared.tags).toEqual(['bodytag']);
    expect(prepared.links).toEqual(['Body Link']);
  });
});

describe('uniqueExportFilename', () => {
  it('keeps the plain filename when the title is unique', () => {
    const used = new Set<string>();
    expect(uniqueExportFilename(used, 'Sample', 'a1a1a1a1-x', '.md')).toBe('Sample.md');
  });

  it('suffixes the note id for duplicate titles so no archive entry is overwritten', () => {
    const used = new Set<string>();
    expect(uniqueExportFilename(used, 'Sample', 'a1a1a1a1-x', '.md')).toBe('Sample.md');
    expect(uniqueExportFilename(used, 'Sample', 'b2b2b2b2-x', '.md')).toBe('Sample_b2b2b2b2.md');
    expect(uniqueExportFilename(used, 'Sample', 'b2b2b2b2-x', '.md')).toBe('Sample_b2b2b2b2_2.md');
  });

  it('sanitizes titles and falls back for empty ones', () => {
    const used = new Set<string>();
    expect(uniqueExportFilename(used, 'a/b:c', 'a1a1a1a1-x', '.html')).toBe('a_b_c.html');
    expect(uniqueExportFilename(used, '', 'a1a1a1a1-x', '.md')).toBe('Untitled.md');
  });
});

describe('vault folder import ignores hidden entries', () => {
  it('buildVaultImportPayload skips files inside dot-directories like .noa', async () => {
    const files = [
      {
        pathSegments: ['MyVault', '.noa', 'internal.md'],
        file: new File(['internal'], 'internal.md', { type: 'text/markdown' }),
      },
      {
        pathSegments: ['MyVault', 'Docs', 'real.md'],
        file: new File(['# Real'], 'real.md', { type: 'text/markdown' }),
      },
    ];
    const folderIdByPath = new Map([
      ['MyVault', 'root-folder'],
      ['MyVault/Docs', 'docs-folder'],
    ]);

    const result = await buildVaultImportPayload(files, folderIdByPath);

    expect(result.notes.map((n) => n.title)).toEqual(['real']);
  });

  it('collectVaultDirectoryEntries ignores dot-directories and dot-files', async () => {
    const root = createMemRoot('MyVault');
    const noaDir = await root.getDirectoryHandle('.noa', { create: true });
    const manifest = await noaDir.getFileHandle('manifest.json', { create: true });
    const writable = await manifest.createWritable();
    await writable.write('{}');
    await writable.close();
    const docs = await root.getDirectoryHandle('Docs', { create: true });
    const note = await docs.getFileHandle('real.md', { create: true });
    const noteWritable = await note.createWritable();
    await noteWritable.write('# Real');
    await noteWritable.close();

    const { folderPaths, files } = await collectVaultDirectoryEntries(
      root as unknown as FileSystemDirectoryHandle,
      ['MyVault'],
    );

    expect([...folderPaths].some((path) => path.includes('.noa'))).toBe(false);
    expect(files.map((f) => f.pathSegments.join('/'))).toEqual(['MyVault/Docs/real.md']);
  });
});
