import { describe, expect, it } from 'vitest';
import { computeOutgoingLinks } from '../../src/hooks/useOutgoingLinks';
import type { Note } from '../../src/types';

const mk = (over: Partial<Note> & Pick<Note, 'id' | 'title'>): Note => ({
  content: '',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
  ...over,
});

describe('computeOutgoingLinks', () => {
  it('returns empty when activeNote is undefined', () => {
    expect(computeOutgoingLinks(undefined, [])).toEqual({ resolved: [], unresolvedTitles: [] });
  });

  it('resolves links via titles', () => {
    const b = mk({ id: 'b', title: 'B' });
    const a = mk({ id: 'a', title: 'A', links: ['B'], linkRefs: ['b'] });
    const { resolved, unresolvedTitles } = computeOutgoingLinks(a, [a, b]);
    expect(resolved.map(n => n.id)).toEqual(['b']);
    expect(unresolvedTitles).toEqual([]);
  });

  it('drops ghost linkRefs whose title is no longer in links', () => {
    // Scenario: [[B]] was removed from content; `links` already excludes B
    // but `linkRefs` still contains b.id (stale, pre-debounce window).
    const b = mk({ id: 'b', title: 'B' });
    const c = mk({ id: 'c', title: 'C' });
    const a = mk({ id: 'a', title: 'A', links: ['C'], linkRefs: ['b', 'c'] });
    const { resolved } = computeOutgoingLinks(a, [a, b, c]);
    expect(resolved.map(n => n.id)).toEqual(['c']);
  });

  it('marks unresolved titles when target was deleted', () => {
    const a = mk({ id: 'a', title: 'A', links: ['B'], linkRefs: [] });
    const { resolved, unresolvedTitles } = computeOutgoingLinks(a, [a]);
    expect(resolved).toEqual([]);
    expect(unresolvedTitles).toEqual(['B']);
  });

  it('resolves a title collision to a single note, matching the graph', () => {
    // Obsidian picks one target per link; root-level notes win, remaining ties
    // break by stable (folder name, id) order.
    const b1 = mk({ id: 'b1', title: 'B' });
    const b2 = mk({ id: 'b2', title: 'B' });
    const a = mk({ id: 'a', title: 'A', links: ['B'], linkRefs: ['b1', 'b2'] });
    const { resolved } = computeOutgoingLinks(a, [a, b1, b2]);
    expect(resolved.map(n => n.id)).toEqual(['b1']);
  });

  it('resolves path links via folder names', () => {
    const inFolder = mk({ id: 'pf', title: 'B', folder: 'f1' });
    const atRoot = mk({ id: 'root', title: 'B' });
    const a = mk({ id: 'a', title: 'A', links: ['Projects/B'] });
    const { resolved } = computeOutgoingLinks(a, [a, inFolder, atRoot], [{ id: 'f1', name: 'Projects' }]);
    expect(resolved.map(n => n.id)).toEqual(['pf']);
  });

  it('filters self-references', () => {
    const a = mk({ id: 'a', title: 'A', links: ['A'], linkRefs: ['a'] });
    const { resolved } = computeOutgoingLinks(a, [a]);
    expect(resolved).toEqual([]);
  });

  it('returns empty resolved when links is empty even if linkRefs leaks', () => {
    const b = mk({ id: 'b', title: 'B' });
    const a = mk({ id: 'a', title: 'A', links: [], linkRefs: ['b'] });
    const { resolved, unresolvedTitles } = computeOutgoingLinks(a, [a, b]);
    expect(resolved).toEqual([]);
    expect(unresolvedTitles).toEqual([]);
  });
});
