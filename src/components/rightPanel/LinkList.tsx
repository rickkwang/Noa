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
  // Matches the app-wide hover convention (noa-sidebar-hover-surface): #EAE5DE in light, a white wash in dark.
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
      {/* Indented past the 13px icon + 6px gap so the second line hangs off the title. */}
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
