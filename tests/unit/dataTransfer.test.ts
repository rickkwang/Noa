import { describe, it, expect } from 'vitest';
import {
  analyzeConflicts,
  applyImportStrategy,
  classifyFolderImportFile,
  countImportedNotes,
  getFolderImportPath,
  prepareImportedNotes,
  validateAttachmentPayloads,
} from '../../src/hooks/useDataTransfer';
import { Note } from '../../src/types';

const makeNote = (id: string, title: string): Note => ({
  id,
  title,
  content: '',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
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
