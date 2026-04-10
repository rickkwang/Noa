import { describe, expect, it } from 'vitest';
import { buildTitleToIdsMap, extractTags, recomputeLinkRefsForNotes } from '../../src/lib/noteUtils';
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
  it('resolves wiki links including all notes with duplicate titles', () => {
    // Previously only uniquely-matched titles were linked; duplicate-title
    // notes were silently dropped from linkRefs and the knowledge graph.
    // Now all matching IDs are included so the graph stays connected.
    const notes = [
      note({ id: 'a', title: 'A', links: ['B', 'Dup'] }),
      note({ id: 'b', title: 'B', links: [] }),
      note({ id: 'd1', title: 'Dup', links: [] }),
      note({ id: 'd2', title: 'Dup', links: [] }),
    ];
    const withRefs = recomputeLinkRefsForNotes(notes);
    const a = withRefs.find((n) => n.id === 'a');
    expect(a?.linkRefs).toEqual(['b', 'd1', 'd2']);
  });
});

describe('extractTags', () => {
  it('does not merge adjacent hashtags into a single tag', () => {
    expect(extractTags('#tag1#tag2')).toEqual([]);
  });

  it('still extracts separated tags at line start and after whitespace', () => {
    expect(extractTags('#tag1 #tag2\n中文 #标签')).toEqual(['tag1', 'tag2', '标签']);
  });
});
