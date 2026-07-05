import { describe, expect, it } from 'vitest';
import { buildTitleToIdsMap, computeTopologySignature, extractLinks, extractTags, recomputeLinkRefsForNotes, sliceHeadingSection } from '../../src/lib/noteUtils';
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

describe('computeTopologySignature', () => {
  it('changes when tags change', () => {
    const before = computeTopologySignature([
      note({ id: 'a', title: 'A', tags: ['work'] }),
    ]);
    const after = computeTopologySignature([
      note({ id: 'a', title: 'A', tags: ['personal'] }),
    ]);

    expect(after).not.toBe(before);
  });
});

describe('extractLinks', () => {
  it('extracts plain wiki links', () => {
    expect(extractLinks('See [[Alpha]] and [[Beta]]')).toEqual(['Alpha', 'Beta']);
  });

  it('strips alias display text', () => {
    expect(extractLinks('[[Real Note|shown]]')).toEqual(['Real Note']);
  });

  it('strips heading anchors', () => {
    expect(extractLinks('[[Note#Morning Routine]]')).toEqual(['Note']);
  });

  it('strips block-id anchors', () => {
    expect(extractLinks('[[Note#^abc123]]')).toEqual(['Note']);
  });

  it('strips anchor + alias combination', () => {
    expect(extractLinks('[[Note#Section|alias]]')).toEqual(['Note']);
  });

  it('deduplicates links across anchors', () => {
    expect(extractLinks('[[A#x]] and [[A#y]] and [[A]]')).toEqual(['A']);
  });

  it('drops empty link targets', () => {
    expect(extractLinks('[[#only-anchor]] [[ ]]')).toEqual([]);
  });
});

describe('extractTags', () => {
  it('ignores hashtags glued together without whitespace (requires boundary)', () => {
    // By design: adjacent hashtags like "#tag1#tag2" are not split — a hashtag
    // must be preceded by start-of-string or whitespace to count.
    expect(extractTags('#tag1#tag2')).toEqual([]);
  });

  it('still extracts separated tags at line start and after whitespace', () => {
    expect(extractTags('#tag1 #tag2\n中文 #标签')).toEqual(['tag1', 'tag2', '标签']);
  });
});

describe('sliceHeadingSection', () => {
  const content = [
    'intro line',
    '# Top',
    'top body',
    '## Section A',
    'a body 1',
    'a body 2',
    '### Sub A1',
    'sub body',
    '## Section B',
    'b body',
  ].join('\n');

  it('slices from the heading to the next same-level heading', () => {
    expect(sliceHeadingSection(content, 'Section A')).toEqual(
      ['## Section A', 'a body 1', 'a body 2', '### Sub A1', 'sub body'].join('\n')
    );
  });

  it('includes deeper subsections but stops at higher-level headings', () => {
    expect(sliceHeadingSection(content, 'Sub A1')).toEqual(
      ['### Sub A1', 'sub body'].join('\n')
    );
  });

  it('runs to end of content when no later boundary exists', () => {
    expect(sliceHeadingSection(content, 'Section B')).toEqual(
      ['## Section B', 'b body'].join('\n')
    );
  });

  it('matches case-insensitively and trims whitespace', () => {
    expect(sliceHeadingSection(content, '  section a ')).toContain('a body 1');
  });

  it('returns null when the heading does not exist', () => {
    expect(sliceHeadingSection(content, 'Missing')).toBeNull();
  });

  it('supports CJK headings', () => {
    const zh = '# 概述\n正文\n# 结论\n结尾';
    expect(sliceHeadingSection(zh, '概述')).toEqual('# 概述\n正文');
  });
});
