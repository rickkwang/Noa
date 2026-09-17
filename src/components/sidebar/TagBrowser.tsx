import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCollapsePresence } from '../../hooks/useCollapsePresence';
import { useResizeDrag } from '../../hooks/useResizeDrag';
import { Note } from '../../types';
import { ChevronDown, Tag } from '@/src/lib/icons';

interface TagBrowserProps {
  notes: Note[];
  onSearchTag?: (tag: string) => void;
  searchQuery?: string;
}

// Curated warm/earthy hues that sit in the same family as the gold/coral accent,
// so tags stay color-coded for classification without breaking the paper theme.
// (terracotta, ochre, gold, mustard, olive, sage, clay-brown, dusty rose)
const TAG_HUES = [12, 26, 40, 52, 74, 98, 22, 348];

function tagHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  }
  return TAG_HUES[(((h % TAG_HUES.length) + TAG_HUES.length) % TAG_HUES.length)];
}

export function TagBrowser({ notes, onSearchTag, searchQuery }: TagBrowserProps) {
  const [isTagsOpen, setIsTagsOpen] = useState(false);
  const isBodyMounted = useCollapsePresence(isTagsOpen);
  const headerRef = useRef<HTMLButtonElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    if (headerRef.current) setHeaderHeight(headerRef.current.offsetHeight);
  }, []);

  // Mirror search.ts's tag-extraction regex so the active-state highlight stays
  // in sync with what the search engine actually filters on.
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

  const { size: tagsHeight, setIsDragging } = useResizeDrag(
    250, 100, 600,
    (e: MouseEvent) => Math.min(window.innerHeight * 0.8, window.innerHeight - e.clientY),
    'row-resize'
  );

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach(note => {
      note.tags?.forEach(tag => {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
      .map(([name, count]) => ({ name, count }));
  }, [notes]);

  // tagsHeight is the whole section, border and header included. The body gets
  // an explicit height rather than the section: a height swap between a number
  // and auto cannot ease, while a fixed body inside a 0fr/1fr track can, and a
  // resize drag still lands in one frame because the track is already 1fr.
  const bodyHeight = Math.max(0, tagsHeight - headerHeight - 1);

  return (
    <div
      className="noa-sidebar-section-surface flex shrink-0 border-t relative flex-col"
      style={{ borderTopColor: 'var(--panel-divider, #2D2D2B)' }}
    >
      {isTagsOpen && (
        <div
          className="h-3 w-full bg-transparent cursor-row-resize absolute top-0 left-0 right-0 z-20 -translate-y-1/2"
          onMouseDown={() => setIsDragging(true)}
        />
      )}
      <button
        ref={headerRef}
        className="w-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#2D2D2B]/70 hover:text-[#2D2D2B] font-redaction flex items-center shrink-0 transition-colors cursor-pointer"
        onClick={() => setIsTagsOpen(v => !v)}
        aria-expanded={isTagsOpen}
      >
        <Tag size={11} className="mr-1.5 shrink-0" />
        Tags Explorer
        <ChevronDown size={10} className={`ml-auto noa-sidebar-collapse-chevron ${isTagsOpen ? '' : '-rotate-90'}`} />
      </button>
      <div className="noa-sidebar-collapse" data-open={isTagsOpen ? 'true' : undefined}>
        <div inert={!isTagsOpen ? true : undefined}>
          {isBodyMounted && (
            <div className="overflow-y-auto px-2.5 pb-2.5 pt-0.5" style={{ height: bodyHeight, scrollbarGutter: 'stable' }}>
              {tags.length === 0 ? (
                <div className="text-xs text-[#2D2D2B]/50 p-1 font-redaction">No tags found in notes</div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {tags.map(tag => {
                    const isActive = activeTags.has(tag.name.toLowerCase());
                    return (
                      <button
                        key={tag.name}
                        onClick={() => onSearchTag?.(tag.name)}
                        data-active={isActive}
                        style={{ ['--tag-h' as string]: tagHue(tag.name) } as React.CSSProperties}
                        className="noa-tag-pill inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-redaction leading-none"
                        title={`#${tag.name}`}
                      >
                        <span className="opacity-50">#</span>
                        <span className="truncate max-w-[150px]">{tag.name}</span>
                        <span className="text-[10px] tabular-nums opacity-55 ml-0.5">{tag.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
