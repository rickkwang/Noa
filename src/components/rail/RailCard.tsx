import React from 'react';
import { ChevronDown, ChevronRight } from '@/src/lib/icons';

interface RailCardProps {
  title: string;
  /** Shown at the right of a collapsed header, so a closed card still says something. */
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/**
 * One card in the note rail: a 1px ring at 10px radius, a 26px header whose title is the collapse button,
 * and a body that opens and closes in one frame. The body stays mounted while collapsed so its state
 * (the calendar's month, the tag filter) survives a collapse.
 */
export function RailCard({ title, summary, open, onToggle, children }: RailCardProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="noa-rail-card shrink-0 rounded-[10px] py-2 font-ui">
      <div className="flex h-[26px] items-center gap-1.5 px-2">
        <h3 className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="noa-rail-card-title flex h-[26px] min-w-0 items-center gap-1 rounded-md px-1 text-xs font-medium"
          >
            <span className="truncate">{title}</span>
            <Chevron size={12} className="noa-rail-muted shrink-0" />
          </button>
        </h3>
        {!open && summary && <span className="noa-rail-muted ms-auto min-w-0 truncate pl-1.5 pr-1 text-xs">{summary}</span>}
      </div>
      <div hidden={!open}>{children}</div>
    </section>
  );
}
