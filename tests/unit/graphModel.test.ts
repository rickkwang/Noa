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

  it('hides nodes whose only links point at filtered-out notes when hideIsolated is on', () => {
    const model = buildGraphModel([
      note({ id: 'a', title: 'Alpha', tags: ['keep'], links: ['Beta'], linkRefs: ['b'] }),
      note({ id: 'b', title: 'Beta', tags: ['keep'], links: [], linkRefs: [] }),
      note({ id: 'c', title: 'Caro', tags: ['keep'], links: ['Delta'], linkRefs: ['d'] }),
      note({ id: 'd', title: 'Delta', tags: ['drop'], links: [], linkRefs: [] }),
    ], { tagFilter: ['keep'], hideIsolated: true });

    // c's only neighbour (d) is filtered out, so c is isolated in the visible
    // graph and must be hidden — and stats.isolated must agree with the toggle.
    expect(model.nodes.map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(model.stats.isolated).toBe(0);
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

  it('ignores stored linkRefs — edges come only from resolving links', () => {
    // Stale frontmatter linkRefs used to union into the edge set, producing
    // edges Obsidian doesn't have.
    const model = buildGraphModel([
      note({ id: 'a', title: 'A', links: [], linkRefs: ['b'] }),
      note({ id: 'b', title: 'B', links: [], linkRefs: [] }),
    ]);
    expect(model.links).toEqual([]);
  });

  it('shows unresolved links as ghost nodes with degree, deduped case-insensitively', () => {
    const model = buildGraphModel([
      note({ id: 'a', title: 'A', links: ['Missing'] }),
      note({ id: 'b', title: 'B', links: ['missing.MD'] }),
    ]);
    const ghost = model.nodes.find((n) => n.ghost);
    expect(ghost?.id).toBe('ghost:missing');
    expect(ghost?.degree).toBe(2);
    expect(model.links).toHaveLength(2);
    // "Your notes" stats skip ghosts.
    expect(model.stats.totalNotes).toBe(2);
    expect(model.stats.ranked.every(([id]) => !id.startsWith('ghost:'))).toBe(true);
  });

  it('keeps ghosts from distinct unresolved paths separate', () => {
    const model = buildGraphModel([
      note({ id: 'a', title: 'A', links: ['x/Note', 'y/Note'] }),
    ], { folders: [] });
    expect(model.nodes.filter((n) => n.ghost).map((n) => n.id).sort()).toEqual(['ghost:x/note', 'ghost:y/note']);
  });

  it('does not create ghosts for attachment embeds', () => {
    // ![[image.png]] lands in note.links; Obsidian hides attachments in the
    // graph by default, so these must not paint ghost nodes.
    const model = buildGraphModel([
      note({ id: 'a', title: 'A', links: ['screenshot.png', 'paper.PDF', 'Missing Note'] }),
    ]);
    expect(model.nodes.filter((n) => n.ghost).map((n) => n.id)).toEqual(['ghost:missing note']);
  });

  it('hides ghost nodes when showUnresolved is off', () => {
    const model = buildGraphModel([
      note({ id: 'a', title: 'A', links: ['Missing'] }),
    ], { showUnresolved: false });
    expect(model.nodes.map((n) => n.id)).toEqual(['a']);
    expect(model.links).toEqual([]);
  });

  it('resolves duplicate titles to a single edge (root wins)', () => {
    const model = buildGraphModel([
      note({ id: 'a', title: 'A', folder: '', links: ['Dup'] }),
      note({ id: 'root', title: 'Dup', folder: '' }),
      note({ id: 'nested', title: 'Dup', folder: 'f1' }),
    ], { folders: [{ id: 'f1', name: 'Projects' }] });
    expect(model.links).toEqual([{ source: 'a', target: 'root', bidirectional: false }]);
  });

  it('draws edges for markdown-style relative links (Obsidian vault shape)', () => {
    // Mirrors a real vault: an index note in "04-Writing" linking to notes in
    // "04-Writing/Excerpts" via [text](./Excerpts/Note.md) markdown links.
    const model = buildGraphModel([
      note({ id: 'index', title: '一些摘抄', folder: 'w', links: ['./Excerpts/Vibe-Coding-Skill.md', 'Self-Reflection.md'] }),
      note({ id: 'v', title: 'Vibe-Coding-Skill', folder: 'we' }),
      note({ id: 'sr', title: 'Self-Reflection', folder: 'w' }),
    ], { folders: [{ id: 'w', name: '04-Writing' }, { id: 'we', name: '04-Writing/Excerpts' }] });
    expect(model.links).toEqual([
      { source: 'index', target: 'v', bidirectional: false },
      { source: 'index', target: 'sr', bidirectional: false },
    ]);
  });

  it('resolves path links via folder names', () => {
    const model = buildGraphModel([
      note({ id: 'a', title: 'A', folder: '', links: ['Projects/Dup'] }),
      note({ id: 'root', title: 'Dup', folder: '' }),
      note({ id: 'nested', title: 'Dup', folder: 'f1' }),
    ], { folders: [{ id: 'f1', name: 'Projects' }] });
    expect(model.links).toEqual([{ source: 'a', target: 'nested', bidirectional: false }]);
  });
});
