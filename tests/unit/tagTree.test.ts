import { describe, expect, it } from 'vitest';
import { buildTagTree, shapeTagTree } from '../../src/lib/tagTree';
import type { Note } from '../../src/types';

const note = (id: string, tags: string[]) => ({ id, tags }) as unknown as Note;

describe('buildTagTree', () => {
  it('nests slash tags and counts distinct notes per subtree', () => {
    const [ai] = buildTagTree([note('1', ['AI/agent', 'AI/infra']), note('2', ['AI/agent'])]);
    expect(ai).toMatchObject({ path: 'AI', isTag: false, count: 2 });
    expect(ai.children.map(c => [c.path, c.count])).toEqual([['AI/agent', 2], ['AI/infra', 1]]);
  });

  it('flags near-duplicate tags', () => {
    const tree = buildTagTree([note('1', ['Communication']), note('2', ['communications']), note('3', ['Writing'])]);
    const byPath = Object.fromEntries(tree.map(n => [n.path, n.similarTo]));
    expect(byPath).toEqual({ Communication: ['communications'], communications: ['Communication'], Writing: [] });
  });
});

describe('shapeTagTree', () => {
  it('keeps ancestors of a match and drops the rest', () => {
    const tree = buildTagTree([note('1', ['AI/agent', 'Writing'])]);
    const shaped = shapeTagTree(tree, 'name', 'agent');
    expect(shaped.map(n => n.path)).toEqual(['AI']);
    expect(shaped[0].children.map(n => n.path)).toEqual(['AI/agent']);
  });
});

describe('tag counts and near-duplicates', () => {
  it('separates a tag’s own notes from its subtree', () => {
    const [ai] = buildTagTree([note('1', ['AI']), note('2', ['AI/agent'])]);
    expect(ai).toMatchObject({ isTag: true, ownCount: 1, count: 2 });
  });

  it('does not fold a plural s on short words', () => {
    const tree = buildTagTree([note('1', ['New']), note('2', ['News'])]);
    expect(tree.every(n => n.similarTo.length === 0)).toBe(true);
  });
});
