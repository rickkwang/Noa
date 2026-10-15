import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { useEdgeFadeRef } from '../../hooks/useEdgeFadeRef';
import { lsGetBoolean, lsGetJson, lsSetBoolean, lsSetJson } from '../../lib/safeLocalStorage';
import { GlobalTask, Note } from '../../types';
import CalendarPanel from '../CalendarPanel';
import { TagBrowser } from '../sidebar/TagBrowser';
import { RailCard } from './RailCard';

// Rail width, its inset from the window edge (clear of the editor's scrollbar), and the gap before the text.
const RAIL_WIDTH = 280;
const RAIL_RIGHT = 14;
export const NOTE_RAIL_RESERVE_PX = RAIL_WIDTH + RAIL_RIGHT + 12;

interface NoteRailProps {
  notes: Note[];
  tasks: GlobalTask[];
  activeNoteId: string;
  searchQuery: string;
  dateFormat: string;
  onOpenDailyNote: (dateStr: string) => void;
  onSearchQuery: (query: string) => void;
  onSearchTag: (tag: string) => void;
  /** Shown over the editor (the right panel is open): one floating panel, flat cards, dismissed by Escape or a click outside. */
  overlay?: boolean;
  onDismiss?: () => void;
}

type CardId = 'calendar' | 'tags';
const DEFAULT_ORDER: CardId[] = ['calendar', 'tags'];
// A drag starts past this many pixels, so a click on the grip doesn't twitch the card.
const DRAG_THRESHOLD = 3;
const GAP = 10;

function readOrder(): CardId[] {
  const saved = lsGetJson<CardId[]>(STORAGE_KEYS.NOTE_RAIL_ORDER);
  const valid = Array.isArray(saved) && saved.length === DEFAULT_ORDER.length && DEFAULT_ORDER.every(id => saved.includes(id));
  return valid ? saved : DEFAULT_ORDER;
}

// Stored as "collapsed" so a card nobody has touched starts open.
function usePersistedCollapse(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => lsGetBoolean(key));
  const toggle = () => setCollapsed(v => { lsSetBoolean(key, !v); return !v; });
  return [!collapsed, toggle];
}

/**
 * Calendar and Tags as cards in a 280px column at the editor's right, independent of the right panel. It sits
 * in the editor scroller's right margin (the text gives way, the scrollbar stays at the window edge), is shown
 * and hidden from the titlebar in one frame, and each card collapses from its own header.
 */
export function NoteRail({ notes, tasks, activeNoteId, searchQuery, dateFormat, onOpenDailyNote, onSearchQuery, onSearchTag, overlay = false, onDismiss }: NoteRailProps) {
  const asideRef = useRef<HTMLElement>(null);
  // Flat cards sit edge to edge, divided by a rule, so there's no gap to account for in a drag.
  const gap = overlay ? 0 : GAP;

  useEffect(() => {
    if (!overlay || !onDismiss) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !ev.defaultPrevented) onDismiss(); };
    // The titlebar toggle is left out: it closes the overlay itself, and closing here first would reopen it.
    const onPointer = (ev: PointerEvent) => {
      const target = ev.target as Element | null;
      if (!target || asideRef.current?.contains(target) || target.closest('[data-note-rail-toggle]')) return;
      onDismiss();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [overlay, onDismiss]);
  const [calendarOpen, toggleCalendar] = usePersistedCollapse(STORAGE_KEYS.NOTE_RAIL_CALENDAR_COLLAPSED);
  const [tagsOpen, toggleTags] = usePersistedCollapse(STORAGE_KEYS.NOTE_RAIL_TAGS_COLLAPSED);
  const fadeRef = useEdgeFadeRef<HTMLDivElement>();
  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const [order, setOrder] = useState<CardId[]>(readOrder);
  const [drag, setDrag] = useState<{ id: CardId; dy: number } | null>(null);
  const cardEls = useRef(new Map<CardId, HTMLElement>());
  // Card tops before a swap, so the card that yields can glide from where it was (FLIP) instead of jumping.
  const flipFrom = useRef<Map<CardId, number> | null>(null);

  useLayoutEffect(() => {
    const before = flipFrom.current;
    if (!before) return;
    flipFrom.current = null;
    for (const [id, top] of before) {
      if (id === drag?.id) continue;
      const el = cardEls.current.get(id);
      if (!el) continue;
      const delta = top - el.getBoundingClientRect().top;
      if (!delta) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform var(--dur-base) var(--ease-out)';
        el.style.transform = '';
      });
    }
  }, [order, drag?.id]);

  const startDrag = (id: CardId) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || drag) return;
    const startY = event.clientY;
    const startOrder = order;
    let current = order;
    // Pixels the card's slot has moved through swaps; subtracted so the card stays under the pointer.
    let slotShift = 0;
    let moved = false;

    const move = (ev: PointerEvent) => {
      const raw = ev.clientY - startY;
      if (!moved) {
        if (Math.abs(raw) < DRAG_THRESHOLD) return;
        moved = true;
      }
      const dy = raw - slotShift;
      const el = cardEls.current.get(id);
      if (el) {
        const rect = el.getBoundingClientRect();
        const centre = rect.top - (Number(el.dataset.dy) || 0) + dy + rect.height / 2;
        const index = current.indexOf(id);
        const neighbour = dy > 0 ? current[index + 1] : current[index - 1];
        const other = neighbour && cardEls.current.get(neighbour);
        if (other) {
          const o = other.getBoundingClientRect();
          // Swap once the held card's centre crosses the neighbour's.
          if ((dy > 0 && centre > o.top + o.height / 2) || (dy < 0 && centre < o.top + o.height / 2)) {
            flipFrom.current = new Map(current.map(cid => [cid, cardEls.current.get(cid)?.getBoundingClientRect().top ?? 0]));
            const next = [...current];
            next[index] = neighbour;
            next[dy > 0 ? index + 1 : index - 1] = id;
            current = next;
            const step = (o.height + gap) * (dy > 0 ? 1 : -1);
            slotShift += step;
            setOrder(next);
            setDrag({ id, dy: raw - slotShift });
            return;
          }
        }
      }
      setDrag({ id, dy });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.body.style.removeProperty('user-select');
      delete document.documentElement.dataset.railGrabbing;
      window.removeEventListener('keydown', onKey, true);
      if (!commit) setOrder(startOrder);
      else if (current !== startOrder) lsSetJson(STORAGE_KEYS.NOTE_RAIL_ORDER, current);
      setDrag(null);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    // On window, not the grip: the pointer leaves the grip as the cards swap under it.
    event.preventDefault();
    document.body.style.userSelect = 'none';
    // Every element's own cursor (the editor's text cursor, buttons) would override one set on body.
    document.documentElement.dataset.railGrabbing = 'true';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey, true);
  };

  const cardProps = (id: CardId) => {
    const held = drag?.id === id;
    return {
      onGripPointerDown: startDrag(id),
      cardRef: (el: HTMLElement | null) => {
        if (el) {
          cardEls.current.set(id, el);
          el.dataset.dy = held ? String(drag!.dy) : '0';
        } else cardEls.current.delete(id);
      },
      first: order[0] === id,
      // Held: follows the pointer with no easing. Released: eases back into its slot. The slot is a flex `order`, not
      // a DOM position: moving the node would restart every CSS animation inside it (the tag rows' entrance).
      style: held
        ? { order: order.indexOf(id), transform: `translateY(${drag!.dy}px)`, transition: 'none', zIndex: 1 }
        : { order: order.indexOf(id), transition: 'transform var(--dur-base) var(--ease-out)' },
    };
  };

  const cards: Record<CardId, React.ReactNode> = {
    calendar: (
      <RailCard key="calendar" title="Calendar" summary={monthLabel} open={calendarOpen} onToggle={toggleCalendar} {...cardProps('calendar')}>
        <CalendarPanel
          notes={notes}
          tasks={tasks}
          activeNoteId={activeNoteId}
          onSelectDate={onOpenDailyNote}
          onSearchRange={onSearchQuery}
          searchQuery={searchQuery}
          dateFormat={dateFormat}
          isOpen={calendarOpen}
        />
      </RailCard>
    ),
    tags: (
      <RailCard key="tags" title="Tags" open={tagsOpen} onToggle={toggleTags} {...cardProps('tags')}>
        <TagBrowser notes={notes} onSearchTag={onSearchTag} searchQuery={searchQuery} isOpen={tagsOpen} />
      </RailCard>
    ),
  };

  return (
    <aside
      ref={asideRef}
      aria-label="Calendar and tags"
      data-note-rail="true"
      data-overlay={overlay || undefined}
      data-dragging={drag ? 'true' : undefined}
      // The first card's top edge lines up with the top of the toolbar icons' drawn strokes (the glyphs sit ~2px
      // inside their boxes). The card covers the toolbar's line where they meet.
      // The overlay floats: in a narrow window it reaches past the editor, over the sidebar's divider (z-30).
      // The overlay's box only bounds the panel: it lets clicks through (so the editor below it still counts as
      // "outside"), and the panel takes its content's height up to the window's bottom inset.
      className={`absolute top-2 flex flex-col ${overlay ? 'pointer-events-none bottom-2 z-[31]' : 'bottom-0 z-20'}`}
      style={{ right: RAIL_RIGHT, width: RAIL_WIDTH }}
    >
      {overlay ? (
        // The panel and its scroller are separate elements: the edge fade is a mask, which would also erase the
        // panel's border and shadow.
        <div className="noa-rail-overlay pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-[10px]">
          <div ref={fadeRef} className="noa-edge-fade-y flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none]">
            {DEFAULT_ORDER.map(id => cards[id])}
          </div>
        </div>
      ) : (
        <div ref={fadeRef} className="noa-edge-fade-y flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-px pb-3 [scrollbar-width:none]">
          {DEFAULT_ORDER.map(id => cards[id])}
        </div>
      )}
    </aside>
  );
}
