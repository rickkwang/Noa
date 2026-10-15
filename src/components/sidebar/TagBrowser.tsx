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

// The most-used top-level tags each get a distinct colour, shared by the summary bar and their rows, so the
// bar reads as a legend. Everything else is one neutral "other". Five hues stay tellable apart at a glance.
const LEADER_COLOURS = 5;
// Top-level tags listed before the rest fold into "Other tags".
const VISIBLE_TAGS = 10;

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
  const [showRest, setShowRest] = useState(false);

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

  // Leaders are ranked by usage whatever the list's sort, so a tag keeps its colour when the order changes.
  const taggedNotes = notes.reduce((n, note) => n + ((note.tags?.length ?? 0) > 0 ? 1 : 0), 0);
  const leaders = useMemo(() => [...tree].sort((x, y) => y.count - x.count).slice(0, LEADER_COLOURS), [tree]);
  const leaderIndex = new Map(leaders.map((node, i) => [node.path, i]));
  const barTotal = tree.reduce((n, t) => n + t.count, 0);
  const otherTotal = barTotal - leaders.reduce((n, t) => n + t.count, 0);
  // A row takes its top-level ancestor's colour, so a child reads as part of its leader.
  const swatchFor = (path: string) => {
    const index = leaderIndex.get(path.split('/')[0]);
    return index === undefined ? 'other' : String(index);
  };

  // A long tail folds into one "Other tags" disclosure row: the first VISIBLE_TAGS
  // top-level tags stay listed (with their open subtrees) and the rest open below it. A filter shows everything.
  const cutoff = isFiltering ? rows.length : (() => {
    let top = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].depth === 0 && ++top > VISIBLE_TAGS) return i;
    }
    return rows.length;
  })();
  const visibleRows = rows.slice(0, cutoff);
  const restRows = rows.slice(cutoff);
  const restTagCount = restRows.filter(r => r.depth === 0).length;

  const renderRow = ({ node, depth, isOpen }: { node: TagNode; depth: number; isOpen: boolean }, index: number) => {
    const hasChildren = node.children.length > 0;
    const isActive = node.isTag && activeTags.has(node.path.toLowerCase());
    const shown = node.isTag ? node.ownCount : node.count;
    // Only the list opening cascades; rows revealed by expanding or filtering appear without a positional delay.
    const stagger = depth === 0 && !filter;
    return (
      <li key={node.path} className="noa-row-in" style={{ '--noa-i': stagger ? index : 0 } as React.CSSProperties}>
        <div
          data-active={isActive}
          style={{ paddingLeft: 4 + depth * 14 }}
          className="noa-tag-row group flex h-5 w-full items-center gap-2.5 rounded-[5px] pr-1 text-xs leading-[15px]"
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
            <span aria-hidden="true" data-swatch={swatchFor(node.path)} className="noa-tag-swatch size-2.5 shrink-0 rounded-[2px]" />
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
          <span className="noa-tag-count min-w-5 shrink-0 text-right tabular-nums">{shown}</span>
        </div>
      </li>
    );
  };

  // The rail card supplies the title row; this is only its body. It grows with the tag list: the rail as a
  // whole scrolls, so there's one scrollbar, at the rail's edge.
  if (!isBodyMounted) return null;
  if (tagCount === 0) return <div className="noa-tag-muted px-3 pb-1 pt-1 text-body">No tags in notes yet</div>;
  return (
    <div className="flex flex-col font-ui">
      <div className="shrink-0 px-2 pt-1">
        {/* One quiet control: search + sort share a single field so the header reads as a unit. */}
        <label className="noa-tag-filter flex h-[26px] items-center gap-2 rounded-md pl-2 pr-1">
          <span className="flex w-3 shrink-0 justify-center"><Search size={13} className="noa-tag-muted" /></span>
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

      <div className="shrink-0 px-3 pb-2 pt-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-body leading-[19px] text-[var(--text-primary,#2D2D2B)]">{tagCount} {tagCount === 1 ? 'tag' : 'tags'}</span>
          <span className="text-xs leading-[15px] tabular-nums text-[var(--text-secondary,#7B7974)]">{taggedNotes} {taggedNotes === 1 ? 'note' : 'notes'} tagged</span>
        </div>
        {/* Share of all tag uses: the leaders in their colours, then everyone else as one neutral segment. */}
        <div className="noa-tag-bar mt-1 flex h-1 gap-px overflow-hidden rounded-full" aria-hidden="true">
          {leaders.map((node, i) => (
            <span key={node.path} data-swatch={i} className="noa-tag-swatch h-full rounded-[1px]" style={{ width: `${(node.count / barTotal) * 100}%` }} />
          ))}
          {otherTotal > 0 && <span data-swatch="other" className="noa-tag-swatch h-full rounded-[1px]" style={{ width: `${(otherTotal / barTotal) * 100}%` }} />}
        </div>
      </div>

      <div className="px-2 pb-0.5">
        {rows.length === 0 ? (
          <div className="noa-tag-muted px-1 py-1 text-xs">No matching tags</div>
        ) : (
          <ul className="flex flex-col">
            {visibleRows.map(renderRow)}
            {restRows.length > 0 && (
              <li className="mt-1.5">
                <button
                  type="button"
                  onClick={() => setShowRest(v => !v)}
                  aria-expanded={showRest}
                  className="noa-tag-row flex h-5 w-full items-center gap-2.5 rounded-[5px] pl-1 pr-1 text-xs leading-[15px]"
                >
                  <span className="noa-tag-muted flex w-2.5 shrink-0 justify-center">
                    <ChevronRight size={11} style={{ transform: showRest ? 'rotate(90deg)' : undefined }} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">Other tags</span>
                  <span className="noa-tag-count min-w-5 shrink-0 text-right tabular-nums">{restTagCount}</span>
                </button>
              </li>
            )}
            {showRest && restRows.map(renderRow)}
          </ul>
        )}
      </div>
    </div>
  );
}
