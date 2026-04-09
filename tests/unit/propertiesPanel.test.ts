import { describe, expect, it } from 'vitest';
import { parseFrontmatterBlock } from '../../src/lib/frontmatter';

describe('parseFrontmatterBlock', () => {
  it('parses yaml list values for read-only imported properties', () => {
    expect(parseFrontmatterBlock(['title: Communications', 'tags:', '  - study', '  - comms', 'created: 2026-03-07'].join('\n'))).toEqual({
      title: 'Communications',
      tags: 'study, comms',
      created: '2026-03-07',
    });
  });
});
