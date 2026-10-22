import { describe, expect, it } from 'vitest';
import { headingLineIndex, headingMatches, headingSlug, parseMarkdownLinkAnchor, scanHeadings } from '../../src/lib/noteUtils';

describe('heading anchors', () => {
  it('matches a heading by its text or by its slug, ignoring case', () => {
    expect(headingMatches('Setup Steps', 'setup steps')).toBe(true);
    expect(headingMatches('Setup Steps', 'setup-steps')).toBe(true);
    expect(headingMatches('Setup Steps', 'install')).toBe(false);
    expect(headingSlug('What is it? (v2)')).toBe('what-is-it-v2');
  });

  it('finds the heading line and skips # lines inside fenced code', () => {
    const content = ['intro', '```', '# Setup', '```', '## Setup', 'body'].join('\n');
    expect(headingLineIndex(content, 'Setup')).toBe(4);
    expect(headingLineIndex(content, 'Missing')).toBeNull();
  });

  it('skips frontmatter comments and only closes a fence with the same character', () => {
    const frontmatter = ['---', '# tags', '---', '# Setup'].join('\n');
    expect(headingLineIndex(frontmatter, 'tags')).toBeNull();
    expect(headingLineIndex(frontmatter, 'Setup')).toBe(3);

    // A ``` line inside a ~~~ fence does not close it.
    const tilde = ['~~~', '```', '~~~', '# Setup'].join('\n');
    expect(headingLineIndex(tilde, 'Setup')).toBe(3);
  });

  it('lists headings for the outline without frontmatter, fenced code or closing #s', () => {
    const content = ['---', '# yaml comment', '---', '## Install ##', '```bash', '# install deps', '```', '### C#'].join('\n');
    expect(scanHeadings(content)).toEqual([
      { level: 2, text: 'Install', lineIndex: 3 },
      { level: 3, text: 'C#', lineIndex: 7 },
    ]);
  });

  it('reads the anchor of a markdown note link, decoded', () => {
    expect(parseMarkdownLinkAnchor('Other.md#Setup%20Steps')).toBe('Setup Steps');
    expect(parseMarkdownLinkAnchor('<Other.md#Setup>')).toBe('Setup');
    expect(parseMarkdownLinkAnchor('Other.md')).toBeNull();
  });
});
