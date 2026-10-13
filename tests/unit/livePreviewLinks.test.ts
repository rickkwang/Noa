import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { linkAt } from '../../src/components/editor/livePreview';

// Cmd/Ctrl+click targets. The click's position is simulated; the lookup itself is what matters here.
const linkAtNeedle = (doc: string, needle: string) => {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  return linkAt(state, doc.indexOf(needle) + 1);
};

describe('linkAt (Cmd/Ctrl+click targets)', () => {
  it('resolves wikilinks to their target, dropping the alias and keeping the anchor', () => {
    expect(linkAtNeedle('see [[Note#Heading]] here', '[[Note')).toEqual({ kind: 'wiki', target: 'Note#Heading' });
    expect(linkAtNeedle('see [[Real|shown]] here', '[[Real')).toEqual({ kind: 'wiki', target: 'Real' });
  });

  it('resolves inline markdown links to their URL', () => {
    expect(linkAtNeedle('a [t](https://example.com) b', '[t]')).toEqual({ kind: 'url', href: 'https://example.com' });
  });

  it('returns null for plain text, wikilinks inside code, and reference links', () => {
    expect(linkAtNeedle('plain words here', 'plain')).toBeNull();
    expect(linkAtNeedle('`[[Note]]` text', '[[Note')).toBeNull();
    expect(linkAtNeedle('[ref][id]', '[ref]')).toBeNull();
  });
});
