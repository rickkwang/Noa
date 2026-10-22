import { describe, expect, it } from 'vitest';
import { parseProperties, removeProperty, setProperty, tagsFromProperties } from '../../src/lib/frontmatterProperties';

const block = [
  'title: Vibe Coding Skill',
  'created: 2026-03-07',
  'tags:',
  '  - Skill',
  'meta:',
  '  nested: 1',
  'note: |',
  '  line one',
].join('\n');

describe('frontmatterProperties', () => {
  it('parses scalars, lists and marks nested shapes read-only', () => {
    expect(parseProperties(block)).toEqual([
      { key: 'title', value: 'Vibe Coding Skill', editable: true },
      { key: 'created', value: '2026-03-07', editable: true },
      { key: 'tags', value: ['Skill'], editable: true },
      { key: 'meta', value: 'nested: 1', editable: false },
      { key: 'note', value: '|\nline one', editable: false },
    ]);
    expect(parseProperties('aliases: [a, b]')[0]).toEqual({ key: 'aliases', value: ['a', 'b'], editable: true });
    expect(parseProperties('aliases: [a, "b, c"]')[0]).toEqual({ key: 'aliases', value: ['a', 'b, c'], editable: true });
    expect(parseProperties('related: ["[[A]]", \'[[B|it\'\'s]]\']')[0]).toEqual({ key: 'related', value: ['[[A]]', "[[B|it's]]"], editable: true });
    expect(parseProperties('grid: [[1, 2], [3]]')[0].editable).toBe(false);
    expect(parseProperties("words: [it's, b]")[0].value).toEqual(["it's", 'b']);
    expect(parseProperties('broken: ["a, b]')[0].editable).toBe(false);
  });

  it('rewrites only the edited property and keeps every other line verbatim', () => {
    const next = setProperty(block, 'tags', ['Skill', 'AI']);
    expect(next).toBe(block.replace('  - Skill', '  - Skill\n  - AI'));
    expect(setProperty(block, 'title', 'a: b')).toBe(block.replace('Vibe Coding Skill', '"a: b"'));
  });

  it('appends new properties, removes existing ones, and keeps CRLF', () => {
    expect(setProperty('a: 1\r\n', 'done', 'true')).toBe('a: 1\r\ndone: true');
    expect(removeProperty(block, 'tags')).not.toContain('- Skill');
    expect(removeProperty(block, 'tags').split('\n')).toHaveLength(6);
  });

  it('derives tags without a leading #', () => {
    expect(tagsFromProperties('tags: [#a, b]')).toEqual(['a', 'b']);
    expect(tagsFromProperties('tags: solo')).toEqual(['solo']);
  });
});
