import { describe, expect, it } from 'vitest';
import { buildGraphModel } from '../../src/lib/graphModel';
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

describe('buildGraphModel', () => {
  it('counts reciprocal links as one visible bidirectional edge', () => {
    const model = buildGraphModel([
      note({ id: 'a', title: 'A', links: ['B'], linkRefs: ['b'] }),
      note({ id: 'b', title: 'B', links: ['A'], linkRefs: ['a'] }),
    ]);

    expect(model.links).toEqual([{ source: 'a', target: 'b', bidirectional: true }]);
    expect(model.stats.totalLinks).toBe(1);
    expect(model.stats.degreeMap.get('a')).toBe(1);
    expect(model.stats.degreeMap.get('b')).toBe(1);
  });

  it('applies search as a real node filter', () => {
    const model = buildGraphModel([
      note({ id: 'a', title: 'Alpha', links: ['Beta'], linkRefs: ['b'] }),
      note({ id: 'b', title: 'Beta', links: [], linkRefs: [] }),
      note({ id: 'g', title: 'Gamma', links: [], linkRefs: [] }),
    ], { searchQuery: 'alp' });

    expect(model.nodes.map((node) => node.id)).toEqual(['a']);
    expect(model.links).toEqual([]);
    expect(model.stats.totalNotes).toBe(1);
  });

  it('keeps the active local node visible when hidden isolated is enabled', () => {
    const model = buildGraphModel([
      note({ id: 'a', title: 'Alpha', links: [], linkRefs: [] }),
      note({ id: 'b', title: 'Beta', links: [], linkRefs: [] }),
    ], { activeNoteId: 'a', localDepth: 1, hideIsolated: true });

    expect(model.nodes.map((node) => node.id)).toEqual(['a']);
    expect(model.stats.isolated).toBe(1);
  });

  it('filters stats and active connections with the same visible graph rules', () => {
    const model = buildGraphModel([
      note({ id: 'a', title: 'Alpha', tags: ['keep'], links: ['Beta', 'Gamma'], linkRefs: ['b', 'g'] }),
      note({ id: 'b', title: 'Beta', tags: ['keep'], links: [], linkRefs: [] }),
      note({ id: 'g', title: 'Gamma', tags: ['drop'], links: [], linkRefs: [] }),
    ], { activeNoteId: 'a', tagFilter: ['keep'] });

    expect(model.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(model.links).toEqual([{ source: 'a', target: 'b', bidirectional: false }]);
    expect(model.stats.totalNotes).toBe(2);
    expect(model.stats.totalLinks).toBe(1);
    expect(model.activeConnections).toEqual(['b']);
  });
});
