import { describe, expect, it } from 'vitest';
import type { Note } from '../../src/types';
import { canReusePreviewContextNotes } from '../../src/components/editor/previewMemo';

const note = (id: string, content: string): Note => ({
  id,
  title: id,
  content,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
});

describe('canReusePreviewContextNotes', () => {
  it('reuses context for an active-note content-only update', () => {
    const previous = [note('active', 'before'), note('embed', 'stable')];
    const next = [{ ...previous[0], content: 'after' }, previous[1]];
    expect(canReusePreviewContextNotes(previous, next, 'active')).toBe(true);
  });

  it('invalidates context when active-note link structure changes', () => {
    const previous = [note('active', 'body')];
    expect(canReusePreviewContextNotes(previous, [{ ...previous[0], title: 'renamed' }], 'active')).toBe(false);
    expect(canReusePreviewContextNotes(previous, [{ ...previous[0], folder: 'moved' }], 'active')).toBe(false);
  });

  it('invalidates context when an embedded note changes', () => {
    const previous = [note('active', 'body'), note('embed', 'before')];
    const next = [previous[0], { ...previous[1], content: 'after' }];
    expect(canReusePreviewContextNotes(previous, next, 'active')).toBe(false);
  });

  it('invalidates context when note order or membership changes', () => {
    const previous = [note('active', 'body'), note('embed', 'body')];
    expect(canReusePreviewContextNotes(previous, [...previous].reverse(), 'active')).toBe(false);
    expect(canReusePreviewContextNotes(previous, previous.slice(0, 1), 'active')).toBe(false);
  });
});
