import React from 'react';
import { Folder, Note } from '../../types';

/**
 * Shared chrome for the two link panels. They are the same list of the same
 * kind of thing pointed in opposite directions, so any drift between them
 * reads as a bug — keep both going through here.
 *
 * A row, not a card: at this width a bordered card spends its whole first line
 * on chrome and pushes the next title 60px down, which is why seven backlinks
 * used to need a scroll. The list carries its own structure through the
 * two-line rhythm and the hover band, and hover is the only surface drawn —
 * nothing is painted until the pointer asks for it.
 */
export function linkSubtitle(note: Note, folders?: Folder[]): string {
  // Folder names are flat but vault-imported ones already carry their full
  // path ("02-Year-2-Study/Communications"), which is exactly the disambiguator
  // wanted here — two notes with the same title differ by where they live.
  if (!note.folder) return '';
  return folders?.find((folder) => folder.id === note.folder)?.name ?? '';
}

// Matches PropertiesPanel's own "no note" state exactly — same sibling tab
// in the same RightPanel, so the two must agree on how "nothing to show
// because nothing is open" looks. This is distinct from "a real note with
// zero links", which the section header already answers with a plain 0;
// conflating the two here made an open note with no links indistinguishable
// from no note being open at all.
export function LinkNoNoteState({ isDark }: { isDark?: boolean }) {
  const muted = isDark ? 'text-[rgba(249,249,247,0.4)]' : 'text-[#2D2D2B]/50';
  return <div className={`text-xs font-redaction text-center py-8 ${muted}`}>No note selected</div>;
}

export function LinkSectionHeader({ label, count, isDark }: { label: string; count: number; isDark?: boolean }) {
  const muted = isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50';
  return (
    <div className="flex items-baseline justify-between px-2 pb-1.5">
      <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${muted}`}>{label}</span>
      <span className={`text-[10px] tabular-nums ${muted}`}>{count}</span>
    </div>
  );
}

export function LinkRow({
  title,
  subtitle,
  icon: Icon,
  onClick,
  dimmed = false,
  isDark,
}: {
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onClick?: () => void;
  dimmed?: boolean;
  isDark?: boolean;
}) {
  const titleColor = dimmed
    ? (isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50')
    : (isDark ? 'text-[#F9F9F7]' : 'text-[#2D2D2B]');
  const subtitleColor = isDark ? 'text-[rgba(249,249,247,0.4)]' : 'text-[#2D2D2B]/40';
  // Dark mode used a flat #302F2C against the #2D2D2B panel — a 3/2/1 RGB
  // step, barely perceptible. Light mode's #EFEAE3/70 wasn't much better:
  // blended against the #FCFCFB panel it lands around #F1EEE9, a 7-14 RGB
  // step. Both now match the hover convention used everywhere else in the
  // app (noa-sidebar-hover-surface): full-strength #EAE5DE in light, a
  // translucent white wash in dark.
  const hover = onClick
    ? (isDark ? 'hover:bg-[rgba(249,249,247,0.07)]' : 'hover:bg-[#EAE5DE]')
    : '';

  const body = (
    <>
      <span className="flex items-center gap-1.5">
        <Icon size={13} className={`shrink-0 ${subtitleColor}`} />
        <span className={`truncate text-[13px] leading-5 ${titleColor} ${onClick ? 'group-hover:text-[#CC7D5E]' : ''} transition-colors`}>
          {title}
        </span>
      </span>
      {/* Indented past the icon so the second line hangs off the title, not off
          the glyph: 13px icon + the 6px gap. */}
      {subtitle && (
        <span className={`block truncate text-[11px] leading-4 pl-[19px] ${subtitleColor}`}>{subtitle}</span>
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
