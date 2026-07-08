import { describe, expect, it } from 'vitest';
import { buildLinkIndex, computeTopologySignature, extractLinks, extractTags, getBacklinks, normalizeLinkKey, recomputeLinkRefsForNotes, resolveLinkTarget, sliceHeadingSection } from '../../src/lib/noteUtils';
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

describe('normalizeLinkKey', () => {
  it('trims, lowercases, and strips one trailing .md', () => {
    expect(normalizeLinkKey('  My Note.MD ')).toBe('my note');
    expect(normalizeLinkKey('Note.md.md')).toBe('note.md');
    expect(normalizeLinkKey('概述')).toBe('概述');
  });
});

describe('resolveLinkTarget', () => {
  const folders = [
    { id: 'f1', name: 'Projects' },
    { id: 'f2', name: 'Archive' },
    { id: 'f3', name: 'Projects/Sub' },
  ];

  it('matches titles case-insensitively', () => {
    const index = buildLinkIndex([note({ id: 'a', title: 'My Note', folder: 'f1' })], folders);
    expect(resolveLinkTarget('my note', index)).toBe('a');
  });

  it('tolerates a trailing .md suffix', () => {
    const index = buildLinkIndex([note({ id: 'a', title: 'Note', folder: 'f1' })], folders);
    expect(resolveLinkTarget('Note.md', index)).toBe('a');
  });

  it('prefers a literal "Note.md" title over suffix stripping', () => {
    const index = buildLinkIndex([
      note({ id: 'plain', title: 'Note', folder: 'f1' }),
      note({ id: 'literal', title: 'Note.md', folder: 'f1' }),
    ], folders);
    expect(resolveLinkTarget('Note.md', index)).toBe('literal');
    expect(resolveLinkTarget('Note', index)).toBe('plain');
  });

  it('resolves [[folder/Note]] path links against folder names', () => {
    const index = buildLinkIndex([
      note({ id: 'p', title: 'Note', folder: 'f1' }),
      note({ id: 'x', title: 'Note', folder: 'f2' }),
    ], folders);
    expect(resolveLinkTarget('Archive/Note', index)).toBe('x');
    expect(resolveLinkTarget('projects/note', index)).toBe('p');
  });

  it('matches nested folder paths on the full dirname', () => {
    const index = buildLinkIndex([note({ id: 's', title: 'Note', folder: 'f3' })], folders);
    expect(resolveLinkTarget('Projects/Sub/Note', index)).toBe('s');
  });

  it('leaves path links with an unknown dirname unresolved (no basename fallback)', () => {
    const index = buildLinkIndex([note({ id: 'a', title: 'Note', folder: 'f1' })], folders);
    expect(resolveLinkTarget('Nowhere/Note', index)).toBeNull();
    // Known folder, but the note is not in it — also unresolved.
    expect(resolveLinkTarget('Archive/Note', index)).toBeNull();
  });

  it('resolves duplicate titles to the root-level note regardless of source', () => {
    const index = buildLinkIndex([
      note({ id: 'root', title: 'A', folder: '' }),
      note({ id: 'nested', title: 'A', folder: 'f1' }),
    ], folders);
    expect(resolveLinkTarget('A', index)).toBe('root');
  });

  it('breaks remaining duplicate ties by stable (folder name, id) order', () => {
    const index = buildLinkIndex([
      note({ id: 'zzz', title: 'A', folder: 'f2' }), // Archive
      note({ id: 'aaa', title: 'A', folder: 'f1' }), // Projects
    ], folders);
    // 'archive' < 'projects' → the Archive note wins independent of input order.
    expect(resolveLinkTarget('A', index)).toBe('zzz');
  });

  it('returns null for unknown titles and empty targets', () => {
    const index = buildLinkIndex([note({ id: 'a', title: 'Note', folder: 'f1' })], folders);
    expect(resolveLinkTarget('Missing', index)).toBeNull();
    expect(resolveLinkTarget('  ', index)).toBeNull();
  });

  it('resolves ./relative paths against the source note folder', () => {
    // A markdown link "./Excerpts/Note.md" written in a note that lives in
    // "Projects" points at the "Projects/Sub"-style nested folder... here:
    // source folder "Projects", target folder "Projects/Sub".
    const index = buildLinkIndex([note({ id: 's', title: 'Note', folder: 'f3' })], folders);
    expect(resolveLinkTarget('./Sub/Note.md', index, 'f1')).toBe('s');
    // Without source context the explicit-relative path cannot resolve.
    expect(resolveLinkTarget('./Sub/Note.md', index)).toBeNull();
  });

  it('resolves plain relative paths after trying vault-absolute first', () => {
    const index = buildLinkIndex([
      note({ id: 'nested', title: 'Note', folder: 'f3' }), // Projects/Sub
    ], folders);
    // "Sub/Note" matches no vault-absolute folder named "Sub" → falls back to
    // source-relative: Projects + Sub = Projects/Sub.
    expect(resolveLinkTarget('Sub/Note.md', index, 'f1')).toBe('nested');
  });

  it('gives vault-absolute paths precedence over relative ones', () => {
    const withArchiveSub = [...folders, { id: 'f4', name: 'Projects/Archive' }];
    const index = buildLinkIndex([
      note({ id: 'abs', title: 'Note', folder: 'f2' }),  // Archive (vault-absolute)
      note({ id: 'rel', title: 'Note', folder: 'f4' }),  // Projects/Archive (relative match)
    ], withArchiveSub);
    expect(resolveLinkTarget('Archive/Note', index, 'f1')).toBe('abs');
    expect(resolveLinkTarget('./Archive/Note', index, 'f1')).toBe('rel');
  });

  it('resolves ../ against the source folder and rejects escapes above root', () => {
    const index = buildLinkIndex([note({ id: 'p', title: 'Note', folder: 'f1' })], folders);
    // From Projects/Sub, "../Note.md" → Projects/Note.md
    expect(resolveLinkTarget('../Note.md', index, 'f3')).toBe('p');
    // From root, "../Note.md" escapes the vault → unresolved.
    expect(resolveLinkTarget('../Note.md', index, '')).toBeNull();
  });

  it('resolves relative links from a root-level note as vault paths', () => {
    const index = buildLinkIndex([note({ id: 's', title: 'Note', folder: 'f3' })], folders);
    expect(resolveLinkTarget('./Projects/Sub/Note.md', index, '')).toBe('s');
  });
});

describe('recomputeLinkRefsForNotes', () => {
  it('resolves each link to exactly one note, Obsidian-style', () => {
    const notes = [
      note({ id: 'a', title: 'A', folder: '', links: ['B', 'Dup'] }),
      note({ id: 'b', title: 'B', folder: '', links: [] }),
      note({ id: 'd1', title: 'Dup', folder: '', links: [] }),
      note({ id: 'd2', title: 'Dup', folder: 'f1', links: [] }),
    ];
    const withRefs = recomputeLinkRefsForNotes(notes, [{ id: 'f1', name: 'Projects' }]);
    const a = withRefs.find((n) => n.id === 'a');
    // Duplicate title "Dup": the root-level note wins; the other id is NOT added.
    expect(a?.linkRefs).toEqual(['b', 'd1']);
  });

  it('drops unresolved links from linkRefs', () => {
    const withRefs = recomputeLinkRefsForNotes([
      note({ id: 'a', title: 'A', links: ['Missing'] }),
    ]);
    expect(withRefs[0].linkRefs).toEqual([]);
  });
});

describe('getBacklinks', () => {
  it('reports backlinks from resolved linkRefs after recompute', () => {
    const target = note({ id: 't', title: 'My Note' });
    const linker = note({ id: 'l', title: 'L', links: ['my note.MD'] });
    const withRefs = recomputeLinkRefsForNotes([target, linker]);
    expect(getBacklinks(target, withRefs).map((n) => n.id)).toEqual(['l']);
  });

  it('does not report a backlink when a duplicate-title link resolves to another note', () => {
    const root = note({ id: 'root', title: 'Dup', folder: '' });
    const nested = note({ id: 'nested', title: 'Dup', folder: 'f1' });
    const linker = note({ id: 'l', title: 'L', folder: '', links: ['Dup'] });
    const withRefs = recomputeLinkRefsForNotes([root, nested, linker], [{ id: 'f1', name: 'Projects' }]);
    // [[Dup]] resolves to the root note — the nested duplicate gets NO backlink.
    expect(getBacklinks(root, withRefs).map((n) => n.id)).toEqual(['l']);
    expect(getBacklinks(nested, withRefs)).toEqual([]);
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

  it('distinguishes the same value appearing in different fields', () => {
    const asLink = computeTopologySignature([
      note({ id: 'a', title: 'A', links: ['x'], linkRefs: [] }),
    ]);
    const asLinkRef = computeTopologySignature([
      note({ id: 'a', title: 'A', links: [], linkRefs: ['x'] }),
    ]);

    expect(asLinkRef).not.toBe(asLink);
  });

  it('distinguishes values split differently across adjacent fields', () => {
    const first = computeTopologySignature([
      note({ id: 'ab', title: 'c' }),
    ]);
    const second = computeTopologySignature([
      note({ id: 'a', title: 'bc' }),
    ]);

    expect(second).not.toBe(first);
  });
});

describe('extractLinks', () => {
  it('extracts plain wiki links', () => {
    expect(extractLinks('See [[Alpha]] and [[Beta]]')).toEqual(['Alpha', 'Beta']);
  });

  it('strips alias display text', () => {
    expect(extractLinks('[[Real Note|shown]]')).toEqual(['Real Note']);
  });

  it('strips table-escaped alias pipes', () => {
    // Inside Markdown tables Obsidian writes [[Note\|display]].
    expect(extractLinks('| [[Real Note\\|shown]] |')).toEqual(['Real Note']);
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

  it('extracts markdown-style internal links to .md files', () => {
    expect(extractLinks('| [Vibe-Coding-Skill](./Excerpts/Vibe-Coding-Skill.md) |')).toEqual(['./Excerpts/Vibe-Coding-Skill.md']);
    expect(extractLinks('[Self-Reflection](Self-Reflection.md)')).toEqual(['Self-Reflection.md']);
  });

  it('percent-decodes markdown link targets, tolerating malformed escapes', () => {
    expect(extractLinks('[Journal](./Journal%20📖.md)')).toEqual(['./Journal 📖.md']);
    // "%泄" is not a valid escape — left as-is instead of throwing.
    expect(extractLinks('[x](A%20B%泄露.md)')).toEqual(['A B%泄露.md']);
  });

  it('ignores external, anchor-only, and non-md markdown links', () => {
    expect(extractLinks('[web](https://example.com/a.md) [anchor](#h) [img](shot.png)')).toEqual([]);
  });

  it('strips #anchors from markdown link targets', () => {
    expect(extractLinks('[x](Note.md#section)')).toEqual(['Note.md']);
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
