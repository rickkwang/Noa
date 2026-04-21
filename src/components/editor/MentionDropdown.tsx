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

export type MentionItem = Suggestion | CreateSuggestion;

const MAX_SUGGESTIONS = 5;

/**
 * Subsequence match: returns indices in `title` (lowercased) where each
 * character of `query` (lowercased) was found in order. Null if no match.
 * Greedy-earliest: picks the first available position for each query char.
 */
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
 * Build the dropdown item list given a query. Pure so it can be unit-tested.
 * Strategy: substring matches first (tighter, preserves recency), then fill
 * remaining slots with fuzzy subsequence matches. Both tiers sorted by
 * updatedAt desc — users reference actively-edited notes, not alphabetical.
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

  // Offer a "Create" row when the query is non-empty AND no existing title
  // exactly matches it. Clicking/Enter inserts [[query]] — the target note
  // itself is created lazily when the user navigates the link
  // (see handleNavigateToNote in useNotes).
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
  // Index by UTF-16 code unit to stay in sync with matchIndices (which come
  // from string.indexOf / title[i]). Array.from(title) would split by code
  // point and misalign on astral-plane characters.
  const chars: string[] = [];
  for (let i = 0; i < title.length; i++) chars.push(title[i]);
  return chars.map((ch, i) =>
    set.has(i)
      ? <span key={i} className="text-[#B89B5E] font-bold">{ch}</span>
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
      className={`absolute z-50 bg-[#EAE8E0] border border-[#2D2D2D] shadow-[4px_4px_0_0_rgba(45,45,45,1)] font-redaction w-64 max-h-48 overflow-y-auto transition-opacity duration-100 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ top: mentionQuery.y, left: mentionQuery.x }}
    >
      <div className="px-3 py-1 bg-[#DCD9CE] border-b border-[#2D2D2D] text-[10px] font-bold uppercase tracking-wider text-[#2D2D2D]/70">
        Link to note
      </div>
      {items.map((item, i) => {
        const active = i === selectedIndex;
        return (
          <div
            key={item.kind === 'existing' ? item.id : `create:${item.title}`}
            ref={active ? selectedRef : undefined}
            className={`px-3 py-2 cursor-pointer border-b border-[#2D2D2D]/10 last:border-0 truncate ${active ? 'bg-[#2D2D2D] text-[#EAE8E0]' : 'hover:bg-[#DCD9CE]'}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onInsert(item.title, mentionQuery.index);
            }}
            onMouseEnter={() => setSelectedIndex(i)}
          >
            {item.kind === 'create' ? (
              <>
                <span className={`text-[10px] uppercase tracking-wider mr-2 ${active ? 'text-[#EAE8E0]/70' : 'text-[#B89B5E]'}`}>New</span>
                <span className="text-xs">{item.title}</span>
              </>
            ) : (
              <span className="text-xs">{renderHighlighted(item.title, item.matchIndices)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
