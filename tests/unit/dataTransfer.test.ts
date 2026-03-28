import { describe, it, expect } from 'vitest';
import { analyzeConflicts, applyImportStrategy } from '../../src/hooks/useDataTransfer';
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
});
