import { describe, it, expect } from 'vitest';
import { parseQuery, SearchEngine } from '../../src/core/search';
import { Note } from '../../src/types';

const makeNote = (id: string, title: string, content: string, tags: string[] = []): Note => ({
  id,
  title,
  content,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: '',
  tags,
  links: [],
});

describe('parseQuery', () => {
  it('parses plain keywords', () => {
    const { keywords, tags, exactPhrases } = parseQuery('hello world');
    expect(keywords).toEqual(['hello', 'world']);
    expect(tags).toHaveLength(0);
    expect(exactPhrases).toHaveLength(0);
  });

  it('parses tag: prefix', () => {
    const { tags } = parseQuery('tag:work');
    expect(tags).toContain('work');
  });

  it('parses tag:#xxx prefix', () => {
    const { tags } = parseQuery('tag:#project');
    expect(tags).toContain('project');
  });

  it('parses exact phrase', () => {
    const { exactPhrases } = parseQuery('"exact match"');
    expect(exactPhrases).toContain('exact match');
  });

  it('lowercases all by default', () => {
    const { keywords } = parseQuery('Hello WORLD');
    expect(keywords).toEqual(['hello', 'world']);
  });

  it('respects caseSensitive flag', () => {
    const { keywords } = parseQuery('Hello WORLD', true);
    expect(keywords).toEqual(['Hello', 'WORLD']);
  });

  it('combines tags and keywords', () => {
    const { keywords, tags } = parseQuery('tag:work meeting');
    expect(tags).toContain('work');
    expect(keywords).toContain('meeting');
  });
});

describe('SearchEngine', () => {
  const notes = [
    makeNote('1', 'Shopping List', 'buy milk and eggs', ['grocery']),
    makeNote('2', 'Work Notes', 'meeting with the team', ['work']),
    makeNote('3', 'Travel Plans', 'visit paris in spring', ['travel']),
  ];

  it('returns all notes for empty query', () => {
    const engine = new SearchEngine(notes);
    const results = engine.search('');
    expect(results).toHaveLength(3);
  });

  it('finds note by title keyword (fuzzy)', () => {
    const engine = new SearchEngine(notes);
    const results = engine.search('shopping');
    expect(results.some(r => r.note.id === '1')).toBe(true);
  });

  it('finds note by content keyword (fuzzy)', () => {
    const engine = new SearchEngine(notes);
    const results = engine.search('meeting');
    expect(results.some(r => r.note.id === '2')).toBe(true);
  });

  it('filters by tag', () => {
    const engine = new SearchEngine(notes);
    const results = engine.search('tag:travel');
    expect(results).toHaveLength(1);
    expect(results[0].note.id).toBe('3');
  });

  it('filters by exact phrase', () => {
    const engine = new SearchEngine(notes);
    const results = engine.search('"buy milk"');
    expect(results.some(r => r.note.id === '1')).toBe(true);
  });

  it('returns no results for non-matching query', () => {
    const engine = new SearchEngine(notes, false, false);
    const results = engine.search('xyzzyxyzzy');
    expect(results).toHaveLength(0);
  });

  it('updates notes collection', () => {
    const engine = new SearchEngine(notes);
    const newNote = makeNote('4', 'New Entry', 'fresh content');
    engine.updateNotes([...notes, newNote]);
    const results = engine.search('fresh');
    expect(results.some(r => r.note.id === '4')).toBe(true);
  });

  it('reuses cached results for same query/config', () => {
    const engine = new SearchEngine(notes);
    const first = engine.search('meeting');
    const second = engine.search('meeting');
    expect(second).toBe(first);
  });

  it('invalidates cache when notes update', () => {
    const engine = new SearchEngine(notes);
    const first = engine.search('travel');
    const newNote = makeNote('4', 'Travel Checklist', 'travel bags');
    engine.updateNotes([...notes, newNote]);
    const second = engine.search('travel');
    expect(second).not.toBe(first);
    expect(second.some(r => r.note.id === '4')).toBe(true);
  });

  it('escapes HTML in highlight output (XSS guard)', () => {
    const xssNote = makeNote('x', 'Safe', '<script>alert(1)</script> note content');
    const engine = new SearchEngine([xssNote], false, false);
    const results = engine.search('"script"');
    const snippet = results[0]?.contentSnippet ?? '';
    // Raw <script> tag must not appear — ensures the browser cannot execute it
    expect(snippet).not.toContain('<script>');
    expect(snippet).not.toContain('</script>');
    // The text is escaped into entities
    expect(snippet).toContain('&lt;');
    expect(snippet).toContain('&gt;');
  });
});
