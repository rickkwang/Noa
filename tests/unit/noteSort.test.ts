import { describe, expect, it } from 'vitest';
import { sortNotesByRecent } from '../../src/lib/noteSort';

const base = {
  title: 'Note',
  content: '',
  folder: 'diary',
  tags: [],
  links: [],
  linkRefs: [],
};

describe('sortNotesByRecent', () => {
  it('sorts by updatedAt desc first', () => {
    const notes = [
      { ...base, id: 'a', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-02T00:00:00.000Z' },
      { ...base, id: 'b', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-03T00:00:00.000Z' },
    ];
    const sorted = sortNotesByRecent(notes);
    expect(sorted.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('falls back to createdAt desc when updatedAt is tied', () => {
    const notes = [
      { ...base, id: 'a', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-03T00:00:00.000Z' },
      { ...base, id: 'b', createdAt: '2024-01-02T00:00:00.000Z', updatedAt: '2024-01-03T00:00:00.000Z' },
    ];
    const sorted = sortNotesByRecent(notes);
    expect(sorted.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('falls back to id asc for fully tied timestamps', () => {
    const notes = [
      { ...base, id: 'z-note', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
      { ...base, id: 'a-note', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
    ];
    const sorted = sortNotesByRecent(notes);
    expect(sorted.map((n) => n.id)).toEqual(['a-note', 'z-note']);
  });
});
