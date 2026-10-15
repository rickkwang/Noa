import React, { useMemo, useState } from 'react';
import { buildTagTree, shapeTagTree, type TagNode, type TagSort } from '../../lib/tagTree';
import { Note } from '../../types';
import { ArrowUpDown, ChevronRight, Search } from '@/src/lib/icons';

interface TagBrowserProps {
  notes: Note[];
  onSearchTag?: (tag: string) => void;
  searchQuery?: string;
  /** Owned by the rail card: false while the card is collapsed. */
  isOpen: boolean;
}

// Warm, earthy hues matching the gold/coral accent, so tags stay colour-coded without breaking the paper theme.
const TAG_HUES = [12, 26, 40, 52, 74, 98, 22, 348];

function tagHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  }
  return TAG_HUES[(((h % TAG_HUES.length) + TAG_HUES.length) % TAG_HUES.length)];
}

export function TagBrowser({ notes, onSearchTag, searchQuery, isOpen: isTagsOpen }: TagBrowserProps) {
  const isBodyMounted = isTagsOpen;

  // Mirrors search.ts's tag regex so the active highlight matches what search filters on.
  const activeTags = useMemo(() => {
    const set = new Set<string>();
    if (!searchQuery) return set;
    const re = /tag:(#?[\w一-龥/-]+)/gi;
    let m;
    while ((m = re.exec(searchQuery)) !== null) {
      set.add(m[1].replace(/^#/, '').toLowerCase());
    }
    return set;
  }, [searchQuery]);

  const [sortBy, setSortBy] = useState<TagSort>('count');
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => buildTagTree(notes), [notes]);
  const tagCount = useMemo(() => {
    const countTags = (list: TagNode[]): number => list.reduce((n, t) => n + (t.isTag ? 1 : 0) + countTags(t.children), 0);
    return countTags(tree);
  }, [tree]);
  const shaped = useMemo(() => shapeTagTree(tree, sortBy, filter), [tree, sortBy, filter]);
  const isFiltering = filter.trim() !== '';

  const toggle = (path: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  // Filtering opens every branch so matches are never hidden behind a collapsed parent.
  const rows: { node: TagNode; depth: number; isOpen: boolean }[] = [];
  const flatten = (list: TagNode[], depth: number) => {
    for (const node of list) {
      const isOpen = node.children.length > 0 && (isFiltering || expanded.has(node.path));
      rows.push({ node, depth, isOpen });
      if (isOpen) flatten(node.children, depth + 1);
    }
  };
  flatten(shaped, 0);

  // The rail card supplies the title row; this is only its body. The list scrolls past a fixed height
  // so a large tag set doesn't push the calendar off the rail.
  if (!isBodyMounted) return null;
  return (
            <div className="flex max-h-[360px] flex-col font-ui">
              {tagCount > 0 && (
                <div className="shrink-0 px-2 pt-1 pb-1">
                  {/* Same both-edges gutter as the list below: field and rows share edges, and left/right insets match. */}
                  {/* One quiet control: search + sort share a single field so the header reads as a unit. */}
                  <label className="noa-tag-filter flex h-[26px] items-center gap-2 rounded-md pl-2 pr-1">
                    <span className="flex w-3 shrink-0 justify-center"><Search size={14} className="noa-tag-muted" /></span>
                    <input
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') setFilter(''); }}
                      placeholder="Filter"
                      aria-label="Filter tags"
                      className="min-w-0 flex-1 bg-transparent text-xs leading-normal outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setSortBy(s => (s === 'count' ? 'name' : 'count'))}
                      title={sortBy === 'count' ? 'Sort: usage' : 'Sort: A–Z'}
                      aria-label="Toggle tag sort order"
                      className="noa-tag-icon-button flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                    >
                      <ArrowUpDown size={13} />
                    </button>
                  </label>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-2 [scrollbar-width:none]">
                {tagCount === 0 ? (
                  <div className="noa-tag-muted px-1 py-1 text-xs">No tags found in notes</div>
                ) : rows.length === 0 ? (
                  <div className="noa-tag-muted px-1 py-1 text-xs">No matching tags</div>
                ) : (
                  <ul className="flex flex-col">
                    {rows.map(({ node, depth, isOpen }) => {
                      const hasChildren = node.children.length > 0;
                      const isActive = node.isTag && activeTags.has(node.path.toLowerCase());
                      return (
                        <li key={node.path}>
                          <div
                            data-active={isActive}
                            style={{ ['--tag-h' as string]: tagHue(node.path), paddingLeft: 8 + depth * 14 } as React.CSSProperties}
                            className="noa-tag-row group flex h-[26px] w-full items-center gap-2 rounded-md pr-1 text-body"
                          >
                            {hasChildren ? (
                              <button
                                onClick={() => toggle(node.path)}
                                aria-label={isOpen ? `Collapse ${node.path}` : `Expand ${node.path}`}
                                className="noa-tag-muted flex h-5 w-3 shrink-0 items-center justify-center"
                              >
                                <ChevronRight size={11} style={{ transition: 'transform 150ms ease', transform: isOpen ? 'rotate(90deg)' : undefined }} />
                              </button>
                            ) : (
                              <span aria-hidden="true" className="flex w-3 shrink-0 justify-center"><span className="noa-tag-dot h-1.5 w-1.5 rounded-full" /></span>
                            )}
                            <button
                              onClick={() => (node.isTag ? onSearchTag?.(node.path) : toggle(node.path))}
                              title={node.isTag ? `#${node.path} · ${node.ownCount} note${node.ownCount === 1 ? '' : 's'}${hasChildren ? ` (${node.count} with subtags)` : ''}` : `${node.path} · ${node.count} note${node.count === 1 ? '' : 's'}`}
                              className={`flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left ${node.isTag ? '' : 'noa-tag-group'}`}
                            >
                              <span className="truncate">{node.name}</span>
                              {node.similarTo.length > 0 && (
                                <span
                                  className="noa-tag-similar shrink-0 rounded px-1 text-micro leading-4"
                                  title={`Looks like a duplicate of ${node.similarTo.map(t => `#${t}`).join(', ')}`}
                                >
                                  ≈
                                </span>
                              )}
                            </button>
                            {/* A real tag shows what clicking it finds (strict match); a pure group shows its subtree. */}
                            <span className="noa-tag-count min-w-5 shrink-0 text-right text-xs tabular-nums">{node.isTag ? node.ownCount : node.count}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
  );
}
