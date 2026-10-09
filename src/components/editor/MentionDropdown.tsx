import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Note } from '../../types';

interface MentionQuery {
  query: string;
  index: number;
  x: number;
  y: number;
}

interface MentionDropdownProps {
  mentionQuery: MentionQuery;
  allNotes: Note[];
  currentNoteId: string;
  onInsert: (title: string, index: number) => void;
  onDismiss: () => void;
}

interface Suggestion {
  kind: 'existing';
  id: string;
  title: string;
  matchIndices: number[];
}

interface CreateSuggestion {
  kind: 'create';
  title: string;
}

type MentionItem = Suggestion | CreateSuggestion;

const MAX_SUGGESTIONS = 5;

/** Subsequence match: indices in `title` of each `query` char, greedy-earliest. Null if no match. */
export function fuzzyMatch(title: string, query: string): number[] | null {
  if (query.length === 0) return [];
  const t = title.toLowerCase();
  const q = query.toLowerCase();
  const indices: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    while (ti < t.length && t[ti] !== q[qi]) ti++;
    if (ti === t.length) return null;
    indices.push(ti);
    ti++;
  }
  return indices;
}

/**
 * Builds the dropdown items. Substring matches first, then fuzzy fill; both tiers sorted by updatedAt desc.
 */
export function buildMentionItems(
  allNotes: Note[],
  currentNoteId: string,
  query: string,
): MentionItem[] {
  const q = query.toLowerCase();
  const candidates = allNotes
    .filter((n) => n.id !== currentNoteId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const substringHits = candidates.filter((n) => n.title.toLowerCase().includes(q));

  const existing: MentionItem[] = substringHits
    .slice(0, MAX_SUGGESTIONS)
    .map((n) => {
      const start = n.title.toLowerCase().indexOf(q);
      const matchIndices = Array.from({ length: q.length }, (_, i) => start + i);
      return { kind: 'existing', id: n.id, title: n.title, matchIndices };
    });

  if (existing.length < MAX_SUGGESTIONS && q.length > 0) {
    const substringIds = new Set(substringHits.map((n) => n.id));
    for (const n of candidates) {
      if (existing.length >= MAX_SUGGESTIONS) break;
      if (substringIds.has(n.id)) continue;
      const m = fuzzyMatch(n.title, q);
      if (m) existing.push({ kind: 'existing', id: n.id, title: n.title, matchIndices: m });
    }
  }

  // "Create" row when no title matches exactly; the target note is created lazily on navigation (useNotes).
  const trimmed = query.trim();
  const hasExactMatch = trimmed.length > 0 &&
    allNotes.some((n) => n.title.toLowerCase() === trimmed);
  if (trimmed.length > 0 && !hasExactMatch) {
    existing.push({ kind: 'create', title: trimmed });
  }
  return existing;
}

function renderHighlighted(title: string, matchIndices: number[]) {
  if (matchIndices.length === 0) return title;
  const set = new Set(matchIndices);
  // Index by UTF-16 code unit to match matchIndices; Array.from would split astral characters and misalign.
  const chars: string[] = [];
  for (let i = 0; i < title.length; i++) chars.push(title[i]);
  return chars.map((ch, i) =>
    set.has(i)
      ? <span key={i} className="text-[#CC7D5E] font-bold">{ch}</span>
      : <span key={i}>{ch}</span>
  );
}

export function MentionDropdown({
  mentionQuery,
  allNotes,
  currentNoteId,
  onInsert,
  onDismiss,
}: MentionDropdownProps) {
  const [visible, setVisible] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [mentionQuery.index]);

  // Reset cursor when query text changes so selection doesn't land on a now-hidden row.
  useEffect(() => { setSelectedIndex(0); }, [mentionQuery.query]);

  const items = useMemo(
    () => buildMentionItems(allNotes, currentNoteId, mentionQuery.query),
    [allNotes, currentNoteId, mentionQuery.query],
  );

  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Mirror callbacks through refs so the keydown listener doesn't rebind on
  // every parent re-render (Editor passes fresh inline arrows each time).
  const onInsertRef = useRef(onInsert);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onInsertRef.current = onInsert; }, [onInsert]);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    if (items.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = items[selectedIndex];
        onInsertRef.current(chosen.title, mentionQuery.index);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismissRef.current();
      }
    };
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [items, selectedIndex, mentionQuery.index]);

  if (items.length === 0) return null;

  return (
    <div
      className={`absolute z-50 bg-[#F9F9F7] border border-[var(--divider-subtle)] rounded-[10px] p-1 noa-floating-panel font-redaction w-64 max-h-48 overflow-y-auto [scrollbar-gutter:stable] transition-opacity duration-100 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ top: mentionQuery.y, left: mentionQuery.x }}
    >
      <div className="flex h-6 items-center px-2 text-[11px] text-[#2D2D2B]/50">
        Link to note
      </div>
      {items.map((item, i) => {
        const active = i === selectedIndex;
        return (
          <div
            key={item.kind === 'existing' ? item.id : `create:${item.title}`}
            ref={active ? selectedRef : undefined}
            // Token-based wash, not a literal hex, so it follows the dark-mode remap.
            className={`flex h-7 items-center px-2 rounded-md cursor-pointer truncate text-[#2D2D2B]/90 ${active ? 'bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_8%,transparent)]' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onInsert(item.title, mentionQuery.index);
            }}
            onMouseEnter={() => setSelectedIndex(i)}
          >
            {item.kind === 'create' ? (
              <>
                <span className="text-[10px] uppercase tracking-wider mr-2 text-[#CC7D5E]">New</span>
                <span className="truncate text-[13px]">{item.title}</span>
              </>
            ) : (
              <span className="truncate text-[13px]">{renderHighlighted(item.title, item.matchIndices)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
