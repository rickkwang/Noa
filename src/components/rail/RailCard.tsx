import React from 'react';
import { ChevronDown, ChevronRight } from '@/src/lib/icons';

interface RailCardProps {
  title: string;
  /** Shown at the right of a collapsed header, so a closed card still says something. */
  summary?: string;
  open: boolean;
  onToggle: () => void;
  /** Starts a reorder drag from the header's grip. */
  onGripPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  dragging?: boolean;
  style?: React.CSSProperties;
  cardRef?: (el: HTMLElement | null) => void;
  children: React.ReactNode;
}

/**
 * One card in the note rail: a 1px ring at 10px radius, a 26px header whose title is the collapse button,
 * and a body that opens and closes in one frame. The body stays mounted while collapsed so its state
 * (the calendar's month, the tag filter) survives a collapse. A grip at the header's right edge,
 * shown on hover, drags the card to a new place in the rail.
 */
export function RailCard({ title, summary, open, onToggle, onGripPointerDown, dragging = false, style, cardRef, children }: RailCardProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section
      ref={cardRef}
      data-dragging={dragging ? 'true' : undefined}
      className="noa-rail-card group/railcard relative shrink-0 rounded-[10px] py-2 font-ui"
      style={style}
    >
      <div className="flex h-[26px] items-center gap-1.5 px-2">
        <h3 className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="noa-rail-card-title flex h-[26px] min-w-0 items-center gap-1 rounded-md px-1 text-xs leading-[15px] font-[500]"
          >
            <span className="truncate">{title}</span>
            <Chevron size={12} className="noa-rail-muted shrink-0" />
          </button>
        </h3>
        {!open && summary && <span className="noa-rail-muted ms-auto min-w-0 truncate pl-1.5 text-xs group-hover/railcard:invisible">{summary}</span>}
        {onGripPointerDown && (
          <button
            type="button"
            aria-label={`Move ${title}`}
            onPointerDown={onGripPointerDown}
            className="noa-rail-grip noa-rail-muted absolute right-2 top-2 flex h-[26px] w-5 cursor-grab touch-none items-center justify-center rounded-md opacity-0 group-hover/railcard:opacity-100 focus-visible:opacity-100"
          >
            <span aria-hidden="true" className="grid grid-cols-2 gap-[2.5px]">
              <i className="size-[1.5px] rounded-full bg-current" />
              <i className="size-[1.5px] rounded-full bg-current" />
              <i className="size-[1.5px] rounded-full bg-current" />
              <i className="size-[1.5px] rounded-full bg-current" />
            </span>
          </button>
        )}
      </div>
      <div hidden={!open}>{children}</div>
    </section>
  );
}
