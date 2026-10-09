import React, { useMemo } from 'react';
import { useResizeDrag } from '../../hooks/useResizeDrag';
import { Note } from '../../types';

interface TagBrowserProps {
  notes: Note[];
  onSearchTag?: (tag: string) => void;
  searchQuery?: string;
  /** Owned by Sidebar: the toggle lives in the footer row. */
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

  // Body gets an explicit height (not auto) so the 0fr/1fr collapse can ease; a drag still lands in one frame.
  const bodyHeight = Math.max(0, tagsHeight - (isBodyMounted ? 1 : 0));

  return (
    // Top divider only while the body is mounted — see CalendarPanel's rule.
    <div
      className={`noa-sidebar-section-surface flex shrink-0 relative flex-col ${isBodyMounted ? 'border-t' : ''}`}
      style={{ borderTopColor: 'var(--panel-divider, #2D2D2B)' }}
    >
      {isTagsOpen && (
        <div
          className="h-3 w-full bg-transparent cursor-row-resize absolute top-0 left-0 right-0 z-20 -translate-y-1/2"
          onMouseDown={() => setIsDragging(true)}
        />
      )}
      <div className="noa-sidebar-collapse" data-open={isTagsOpen ? 'true' : undefined}>
        <div inert={!isTagsOpen ? true : undefined}>
          {isBodyMounted && (
            <div className="overflow-y-auto px-2.5 pb-2.5 pt-2.5" style={{ height: bodyHeight, scrollbarGutter: 'stable' }}>
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
