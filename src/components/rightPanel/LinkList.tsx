import React from 'react';
import { Folder, Note } from '../../types';

/**
 * Shared chrome for the two link panels (backlinks and outgoing), so they can't drift apart.
 * A row, not a card: a bordered card spends its first line on chrome. Hover is the only surface drawn.
 */
export function linkSubtitle(note: Note, folders?: Folder[]): string {
  // Vault-imported folder names already carry their full path, which disambiguates same-titled notes.
  if (!note.folder) return '';
  return folders?.find((folder) => folder.id === note.folder)?.name ?? '';
}

// Must match PropertiesPanel's "no note" state. Distinct from "a real note with zero links" (the header shows 0).
export function LinkNoNoteState() {
  return <div className="noa-hint-in text-xs font-ui text-center py-8 text-[var(--sidebar-text-muted,#898781)]">No note selected</div>;
}

export function LinkSectionHeader({ label, count }: { label: string; count: number }) {
  // Sentence-case label with its count beside it: same size as the card title, quieter only by colour.
  return (
    <div className="flex items-baseline gap-1.5 px-2 pb-1.5 text-body text-[var(--sidebar-text-muted,#898781)]">
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
    </div>
  );
}

export function LinkRow({
  title,
  subtitle,
  snippet,
  icon: Icon,
  onClick,
  dimmed = false,
}: {
  title: string;
  subtitle?: string;
  /** The line the link sits on, shown under the title; the folder then rides beside the title instead. */
  snippet?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onClick?: () => void;
  dimmed?: boolean;
}) {
  const titleColor = dimmed ? 'text-[var(--sidebar-text-muted,#898781)]' : 'text-[var(--text-primary,#2D2D2B)]';
  const subtitleColor = 'text-[var(--sidebar-text-muted,#898781)]';
  // Matches the app-wide hover convention (a 5% ink wash, as noa-sidebar-hover-surface uses).
  // Hover only lifts the surface; the title keeps its colour.
  const hover = onClick ? 'hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)]' : '';

  const body = (
    <>
      <span className="flex items-center gap-1.5">
        <Icon size={13} className={`shrink-0 ${subtitleColor}`} />
        <span className={`truncate text-body leading-5 ${titleColor}`} data-capture-redact>
          {title}
        </span>
        {snippet && subtitle && (
          <span className={`ml-auto shrink-0 max-w-[40%] truncate text-caption ${subtitleColor}`} data-capture-redact>{subtitle}</span>
        )}
      </span>
      {/* Indented past the 13px icon + 6px gap so the second line hangs off the title. */}
      {(snippet || subtitle) && (
        <span className={`block text-caption leading-4 pl-[19px] ${subtitleColor} ${snippet ? 'line-clamp-2 break-words' : 'truncate'}`} data-capture-redact>{snippet || subtitle}</span>
      )}
    </>
  );

  if (!onClick) {
    return <div className="w-full px-2 py-1 rounded-[8px]">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full text-left px-2 py-1 rounded-[8px] transition-colors ${hover}`}
    >
      {body}
    </button>
  );
}
