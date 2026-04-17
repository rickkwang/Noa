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

  it('returns both notes when two share a title (collision)', () => {
    const b1 = mk({ id: 'b1', title: 'B' });
    const b2 = mk({ id: 'b2', title: 'B' });
    const a = mk({ id: 'a', title: 'A', links: ['B'], linkRefs: ['b1', 'b2'] });
    const { resolved } = computeOutgoingLinks(a, [a, b1, b2]);
    expect(new Set(resolved.map(n => n.id))).toEqual(new Set(['b1', 'b2']));
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
