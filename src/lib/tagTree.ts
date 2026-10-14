import type { Note } from '../types';

export interface TagNode {
  /** Last path segment, e.g. `agent` for `AI/agent`. */
  name: string;
  /** Full tag path; what search filters on when `isTag`. */
  path: string;
  /** Distinct notes tagged with this path or anything beneath it. */
  count: number;
  /** Notes tagged with exactly this path — what clicking it (strict tag search) returns. */
  ownCount: number;
  /** False for a parent that only exists because a child uses it as a prefix. */
  isTag: boolean;
  children: TagNode[];
  /** Other tags whose name differs only by case, separators, or a plural `s`. */
  similarTo: string[];
}

export type TagSort = 'count' | 'name';

// Plural `s` only folds on longer words, so `New`/`News` or `Op`/`Ops` aren't flagged.
const similarityKey = (path: string) => {
  const key = path.toLowerCase().replace(/[\s_-]+/g, '');
  return key.length >= 5 ? key.replace(/s$/, '') : key;
};

const byName = (a: TagNode, b: TagNode) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export function buildTagTree(notes: Note[]): TagNode[] {
  const nodes = new Map<string, TagNode & { noteIds: Set<string>; ownIds: Set<string> }>();
  const roots: TagNode[] = [];

  const ensure = (path: string) => {
    let node = nodes.get(path);
    if (node) return node;
    const slash = path.lastIndexOf('/');
    node = { name: path.slice(slash + 1), path, count: 0, ownCount: 0, isTag: false, children: [], similarTo: [], noteIds: new Set(), ownIds: new Set() };
    nodes.set(path, node);
    (slash === -1 ? roots : ensure(path.slice(0, slash)).children).push(node);
    return node;
  };

  for (const note of notes) {
    for (const raw of note.tags ?? []) {
      const tag = raw.replace(/^\/+|\/+$/g, '');
      if (!tag) continue;
      const node = ensure(tag);
      node.ownIds.add(note.id);
      node.isTag = true;
      const parts = tag.split('/');
      for (let i = 1; i <= parts.length; i++) nodes.get(parts.slice(0, i).join('/'))!.noteIds.add(note.id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const node of nodes.values()) {
    node.count = node.noteIds.size;
    node.ownCount = node.ownIds.size;
    if (!node.isTag) continue;
    const key = similarityKey(node.path);
    groups.set(key, [...(groups.get(key) ?? []), node.path]);
  }
  for (const paths of groups.values()) {
    if (paths.length < 2) continue;
    for (const p of paths) nodes.get(p)!.similarTo = paths.filter(o => o !== p);
  }

  return roots;
}

/** Sorted copy; with a query, keeps matching nodes plus their ancestors (and a match's whole subtree). */
export function shapeTagTree(nodes: TagNode[], sort: TagSort, query: string): TagNode[] {
  const q = query.trim().replace(/^#/, '').toLowerCase();
  const compare = sort === 'count' ? (a: TagNode, b: TagNode) => b.count - a.count || byName(a, b) : byName;
  const walk = (list: TagNode[], keepAll: boolean): TagNode[] =>
    list
      .map(node => {
        const hit = keepAll || !q || node.path.toLowerCase().includes(q);
        const children = walk(node.children, hit);
        return hit || children.length > 0 ? { ...node, children } : null;
      })
      .filter((n): n is TagNode => n !== null)
      .sort(compare);
  return walk(nodes, false);
}
