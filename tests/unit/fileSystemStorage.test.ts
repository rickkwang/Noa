import { describe, expect, it, vi } from 'vitest';
import { __test__ } from '../../src/lib/fileSystemStorage';
import type { Note } from '../../src/types';

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'note-1',
  title: 'Sample',
  content: '# Sample',
  createdAt: '2026-04-09T12:00:00.000Z',
  updatedAt: '2026-04-09T12:00:00.000Z',
  folder: 'folder-1',
  tags: [],
  links: [],
  linkRefs: [],
  ...overrides,
});

describe('fileSystemStorage frontmatter write-back', () => {
  it('strips Noa-owned metadata from preserved raw frontmatter', () => {
    const raw = [
      'id: abc',
      'folder: root',
      'title: Keep me',
      'tags:',
      '  - work',
      'links: []',
      'linkRefs: []',
      'createdAt: 2026-04-09T12:00:00.000Z',
      'noaSource: noa',
      'created: 2026-04-05',
    ].join('\n');

    expect(__test__.sanitizeRawFrontmatter(raw)).toBe([
      'title: Keep me',
      'tags:',
      '  - work',
      'created: 2026-04-05',
    ].join('\n'));
  });

  it('preserves user-owned keys like id:/links: verbatim when writing back an imported note', () => {
    const note = makeNote({
      source: 'obsidian-import',
      rawFrontmatter: ['id: 20240101', 'links:', '  - projects/alpha', 'created: 2026-04-05'].join('\n'),
    });

    expect(__test__.buildFrontMatter(note)).toBe([
      '---',
      'id: 20240101',
      'links:',
      '  - projects/alpha',
      'created: 2026-04-05',
      '---',
      '',
    ].join('\n'));
  });

  it('writes CRLF frontmatter delimiters when the imported block uses CRLF', () => {
    const note = makeNote({
      source: 'obsidian-import',
      rawFrontmatter: 'title: Keep\r\ncreated: 2026-04-05',
    });

    expect(__test__.buildFrontMatter(note)).toBe('---\r\ntitle: Keep\r\ncreated: 2026-04-05\r\n---\r\n');
  });

  it('does not inject Noa metadata when writing back an imported note', () => {
    const note = makeNote({
      source: 'obsidian-import',
      tags: ['work'],
      rawFrontmatter: ['title: Keep me', 'tags:', '  - work', 'created: 2026-04-05'].join('\n'),
    });

    const frontmatter = __test__.buildFrontMatter(note);
    expect(frontmatter).toContain('title: Keep me');
    expect(frontmatter).toContain('created: 2026-04-05');
    expect(frontmatter).not.toContain('id:');
    expect(frontmatter).not.toContain('folder:');
    expect(frontmatter).not.toContain('links:');
    expect(frontmatter).not.toContain('linkRefs:');
    expect(frontmatter).not.toContain('createdAt:');
    expect(frontmatter).not.toContain('noaSource:');
  });

  it('writes recoverable Noa identity metadata for native notes without existing frontmatter', () => {
    const note = makeNote({ tags: ['work', 'project/x'] });
    expect(__test__.buildFrontMatter(note)).toBe([
      '---',
      'id: note-1',
      'createdAt: "2026-04-09T12:00:00.000Z"',
      'noaSource: noa',
      'tags:',
      '  - work',
      '  - project/x',
      '---',
      '',
    ].join('\n'));
  });

  it('does not duplicate existing tags when adding native Noa identity metadata', () => {
    const note = makeNote({
      tags: ['work'],
      rawFrontmatter: ['title: Keep me', 'tags:', '  - work'].join('\n'),
    });

    expect(__test__.buildFrontMatter(note)).toBe([
      '---',
      'title: Keep me',
      'tags:',
      '  - work',
      'id: note-1',
      'createdAt: "2026-04-09T12:00:00.000Z"',
      'noaSource: noa',
      '---',
      '',
    ].join('\n'));
  });
});

describe('fileSystemStorage persisted handle restore', () => {
  it('does not request permission during bootstrap when a handle is stored', async () => {
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('prompt'),
      requestPermission: vi.fn().mockResolvedValue('denied'),
    };
    const store = {
      getItem: vi.fn().mockResolvedValue(handle as any),
    };

    const restored = await __test__.restoreHandleFromStore(store as any);

    expect(restored).toBe(handle);
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });
});
