import { describe, expect, it } from 'vitest';
import { buildTitleToIdsMap, recomputeLinkRefsForNotes } from '../../src/lib/noteUtils';
import { Note } from '../../src/types';

const note = (overrides: Partial<Note>): Note => ({
  id: 'n1',
  title: 'A',
  content: '',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: 'f1',
  tags: [],
  links: [],
  linkRefs: [],
  ...overrides,
});

describe('buildTitleToIdsMap', () => {
  it('collects duplicate titles by id', () => {
    const map = buildTitleToIdsMap([
      note({ id: 'n1', title: 'Daily' }),
      note({ id: 'n2', title: 'Daily' }),
      note({ id: 'n3', title: 'Weekly' }),
    ]);
    expect(map.get('Daily')).toEqual(['n1', 'n2']);
    expect(map.get('Weekly')).toEqual(['n3']);
  });
});

describe('recomputeLinkRefsForNotes', () => {
  it('resolves only uniquely matched wiki links', () => {
    const notes = [
      note({ id: 'a', title: 'A', links: ['B', 'Dup'] }),
      note({ id: 'b', title: 'B', links: [] }),
      note({ id: 'd1', title: 'Dup', links: [] }),
      note({ id: 'd2', title: 'Dup', links: [] }),
    ];
    const withRefs = recomputeLinkRefsForNotes(notes);
    const a = withRefs.find((n) => n.id === 'a');
    expect(a?.linkRefs).toEqual(['b']);
  });
});
