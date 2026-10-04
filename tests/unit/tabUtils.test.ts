import { describe, expect, it } from 'vitest';
import { addTabId, MAX_OPEN_TABS, moveTabId, removeTabAndPickNext } from '../../src/lib/tabUtils';

describe('addTabId', () => {
  it('appends a new tab', () => {
    expect(addTabId(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('returns the same array reference when the tab is already open', () => {
    const prev = ['a', 'b'];
    expect(addTabId(prev, 'b')).toBe(prev);
  });

  it('evicts the leftmost tab when at capacity', () => {
    const full = Array.from({ length: MAX_OPEN_TABS }, (_, i) => `t${i}`);
    const next = addTabId(full, 'new');
    expect(next).toHaveLength(MAX_OPEN_TABS);
    expect(next[0]).toBe('t1');
    expect(next[MAX_OPEN_TABS - 1]).toBe('new');
  });

  it('resets to a single tab when every slot holds the incoming id', () => {
    expect(addTabId(['x', 'x'], 'y', 2)).toEqual(['x', 'y']);
    expect(addTabId(['y', 'y'], 'y', 2)).toEqual(['y', 'y']);
  });
});

describe('removeTabAndPickNext', () => {
  it('is a no-op when the tab is not open', () => {
    expect(removeTabAndPickNext(['a', 'b'], 'z', 'a')).toEqual({ next: ['a', 'b'], nextActive: null });
  });

  it('keeps the active tab when closing a different tab', () => {
    expect(removeTabAndPickNext(['a', 'b', 'c'], 'a', 'b')).toEqual({ next: ['b', 'c'], nextActive: null });
  });

  it('prefers the tab to the right when closing the active tab', () => {
    expect(removeTabAndPickNext(['a', 'b', 'c'], 'b', 'b')).toEqual({ next: ['a', 'c'], nextActive: 'c' });
  });

  it('falls back to the left tab when the active tab is last', () => {
    expect(removeTabAndPickNext(['a', 'b', 'c'], 'c', 'c')).toEqual({ next: ['a', 'b'], nextActive: 'b' });
  });

  it('clears the selection when the last tab closes', () => {
    expect(removeTabAndPickNext(['a'], 'a', 'a')).toEqual({ next: [], nextActive: '' });
  });
});

describe('moveTabId', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves a tab forward after the target', () => {
    expect(moveTabId(ids, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves a tab backward before the target', () => {
    expect(moveTabId(ids, 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves to either end', () => {
    expect(moveTabId(ids, 'b', 'd', true)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveTabId(ids, 'c', 'a', false)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('returns the same array when the order would not change', () => {
    expect(moveTabId(ids, 'b', 'c', false)).toBe(ids);
    expect(moveTabId(ids, 'b', 'b', true)).toBe(ids);
  });

  it('ignores unknown ids', () => {
    expect(moveTabId(ids, 'x', 'a', false)).toBe(ids);
    expect(moveTabId(ids, 'a', 'x', true)).toBe(ids);
  });
});
