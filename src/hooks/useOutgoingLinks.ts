import { useMemo } from 'react';
import { Note } from '../types';
import { buildTitleToIdsMap } from '../lib/noteUtils';

export interface OutgoingLinks {
  resolved: Note[];
  unresolvedTitles: string[];
}

/**
 * Single source of truth for a note's outgoing [[wikilinks]].
 *
 * `links` (extracted from content) is authoritative for which titles the
 * author currently references. `linkRefs` is only consulted to disambiguate
 * when the same title maps to multiple notes (title collisions). Any id in
 * `linkRefs` whose note's title is no longer in `links` is discarded — that
 * is the "ghost link" case we want to avoid.
 */
export function computeOutgoingLinks(
  activeNote: Note | undefined,
  notes: Note[],
): OutgoingLinks {
  if (!activeNote) return { resolved: [], unresolvedTitles: [] };

  const titleToIds = buildTitleToIdsMap(notes);
  const idToNote = new Map(notes.map((n) => [n.id, n]));
  const linkTitles = activeNote.links ?? [];
  const linkTitleSet = new Set(linkTitles);
  const seen = new Set<string>();
  const resolved: Note[] = [];
  const unresolvedTitles: string[] = [];

  linkTitles.forEach((title) => {
    const ids = titleToIds.get(title);
    if (!ids || ids.length === 0) {
      unresolvedTitles.push(title);
      return;
    }
    ids.forEach((id) => {
      if (id === activeNote.id || seen.has(id)) return;
      const target = idToNote.get(id);
      if (!target) return;
      seen.add(id);
      resolved.push(target);
    });
  });

  // linkRefs supplements for title-collision disambiguation (a ref id whose
  // title is still in links but was not picked up above). Ids whose titles
  // have been removed from links are intentionally dropped.
  (activeNote.linkRefs ?? []).forEach((id) => {
    if (id === activeNote.id || seen.has(id)) return;
    const target = idToNote.get(id);
    if (!target) return;
    if (!linkTitleSet.has(target.title)) return;
    seen.add(id);
    resolved.push(target);
  });

  return { resolved, unresolvedTitles };
}

export function useOutgoingLinks(
  activeNote: Note | undefined,
  notes: Note[],
): OutgoingLinks {
  return useMemo(() => computeOutgoingLinks(activeNote, notes), [activeNote, notes]);
}
