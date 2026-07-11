import React, { useMemo, useState } from 'react';
import { ChevronDown, Tag } from '@/src/lib/icons';
import { Note } from '../../types';
import { useResizeDrag } from '../../hooks/useResizeDrag';

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

  return (
    <div
      className="noa-sidebar-section-surface flex shrink-0 border-t border-[#2D2D2B] relative flex-col"
      style={{ height: isTagsOpen ? tagsHeight : 'auto' }}
    >
      {isTagsOpen && (
        <div
          className="h-3 w-full bg-transparent hover:bg-[#CC7D5E]/20 cursor-row-resize absolute top-0 left-0 right-0 z-20 -translate-y-1/2 transition-colors"
          onMouseDown={() => setIsDragging(true)}
        />
      )}
      <button
        className="w-full px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#2D2D2B]/40 hover:text-[#2D2D2B]/70 font-redaction border-b border-[#2D2D2B]/20 flex items-center shrink-0 transition-colors cursor-pointer"
        onClick={() => setIsTagsOpen(v => !v)}
        aria-expanded={isTagsOpen}
      >
        <Tag size={12} className="mr-1.5 shrink-0" />
        Tags Explorer
        <ChevronDown size={11} className={`ml-auto transition-transform duration-100 ease-out ${isTagsOpen ? '' : '-rotate-90'}`} />
      </button>
      {isTagsOpen && (
        <div className="flex-1 overflow-y-auto p-2.5 slide-down" style={{ scrollbarGutter: 'stable' }}>
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
                    className="noa-tag-pill inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-redaction leading-none active:opacity-70"
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
  );
}
