import { describe, expect, it } from 'vitest';
import { buildMentionItems, fuzzyMatch } from '../../src/components/editor/MentionDropdown';
import { Note } from '../../src/types';

function makeNote(id: string, title: string, updatedAt: string): Note {
  return {
    id,
    title,
    content: '',
    folder: 'diary',
    tags: [],
    links: [],
    linkRefs: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('buildMentionItems', () => {
  const notes: Note[] = [
    makeNote('a', 'Alpha', '2026-04-20T10:00:00Z'),
    makeNote('b', 'Beta',  '2026-04-20T12:00:00Z'),
    makeNote('c', 'Alpine', '2026-04-20T09:00:00Z'),
    makeNote('d', 'Gamma', '2026-04-20T08:00:00Z'),
  ];

  it('filters by lowercase substring and excludes current note', () => {
    const items = buildMentionItems(notes, 'a', 'alp');
    // current note 'a' excluded; 'Alpine' matches 'alp'
    expect(items.map((i) => i.kind === 'existing' ? i.id : `new:${i.title}`))
      .toEqual(['c', 'new:alp']);
  });

  it('sorts existing matches by updatedAt desc', () => {
    const items = buildMentionItems(notes, 'x', ''); // empty query matches all (except current)
    expect(items.map((i) => i.kind === 'existing' ? i.id : 'create'))
      .toEqual(['b', 'a', 'c', 'd']); // b(12:00) > a(10:00) > c(09:00) > d(08:00)
  });

  it('caps existing matches at 5', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeNote(`n${i}`, `Note ${i}`, `2026-04-${10 + i}T00:00:00Z`),
    );
    const items = buildMentionItems(many, 'zzz', 'note');
    // non-create items
    const existing = items.filter((i) => i.kind === 'existing');
    expect(existing).toHaveLength(5);
  });

  it('appends a Create row when query has no exact match', () => {
    const items = buildMentionItems(notes, 'x', 'newthing');
    const last = items[items.length - 1];
    expect(last).toEqual({ kind: 'create', title: 'newthing' });
  });

  it('omits Create row when an existing title matches exactly (case-insensitive)', () => {
    const items = buildMentionItems(notes, 'x', 'alpha');
    expect(items.some((i) => i.kind === 'create')).toBe(false);
    expect(items[0]).toMatchObject({ kind: 'existing', title: 'Alpha' });
  });

  it('omits Create row when query is empty or whitespace', () => {
    expect(buildMentionItems(notes, 'x', '').some((i) => i.kind === 'create')).toBe(false);
    expect(buildMentionItems(notes, 'x', '   ').some((i) => i.kind === 'create')).toBe(false);
  });

  it('Create row uses trimmed query', () => {
    const items = buildMentionItems(notes, 'x', '  draft  ');
    const create = items.find((i) => i.kind === 'create');
    expect(create).toEqual({ kind: 'create', title: 'draft' });
  });

  it('returns matchIndices for substring matches (contiguous run)', () => {
    const items = buildMentionItems(notes, 'x', 'alp');
    const alpha = items.find((i) => i.kind === 'existing' && i.id === 'a');
    expect(alpha).toMatchObject({ matchIndices: [0, 1, 2] });
  });

  it('falls back to fuzzy subsequence when substring misses', () => {
    const fuzzyNotes: Note[] = [
      makeNote('f1', 'Alpha Beta Gamma', '2026-04-20T10:00:00Z'),
    ];
    // "abg" is not a substring but is a subsequence of "Alpha Beta Gamma"
    const items = buildMentionItems(fuzzyNotes, 'x', 'abg');
    expect(items).toHaveLength(2); // 1 fuzzy + 1 create
    const existing = items.find((i) => i.kind === 'existing');
    expect(existing).toMatchObject({ id: 'f1' });
    expect((existing as any).matchIndices).toHaveLength(3);
  });

  it('substring matches rank above fuzzy matches', () => {
    const mixed: Note[] = [
      makeNote('s1', 'banana', '2026-04-20T08:00:00Z'),      // substring "ban"
      makeNote('f1', 'Big Alpha Network', '2026-04-20T20:00:00Z'), // newer but only fuzzy "ban"
    ];
    const items = buildMentionItems(mixed, 'x', 'ban');
    const ids = items.filter((i) => i.kind === 'existing').map((i) => (i as any).id);
    expect(ids).toEqual(['s1', 'f1']);
  });
});

describe('fuzzyMatch', () => {
  it('returns empty array for empty query', () => {
    expect(fuzzyMatch('anything', '')).toEqual([]);
  });

  it('returns null when chars missing', () => {
    expect(fuzzyMatch('abc', 'abd')).toBeNull();
  });

  it('returns null when order mismatched', () => {
    expect(fuzzyMatch('abc', 'cba')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('Alpha', 'AL')).toEqual([0, 1]);
    expect(fuzzyMatch('alpha', 'AL')).toEqual([0, 1]);
  });

  it('picks earliest positions greedily', () => {
    expect(fuzzyMatch('abacab', 'ab')).toEqual([0, 1]);
  });
});
