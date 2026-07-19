import { useMemo } from 'react';
import { buildLinkIndex, resolveLinkTarget } from '../lib/noteUtils';
import { Folder, Note } from '../types';

export interface OutgoingLinks {
  resolved: Note[];
  unresolvedTitles: string[];
}

/**
 * Single source of truth for a note's outgoing [[wikilinks]].
 *
 * `links` (extracted from content) is authoritative for which targets the
 * author currently references. Each target resolves to at most ONE note via
 * the shared Obsidian-aligned resolver, so this panel always agrees with the
 * knowledge graph's edges.
 */
export function computeOutgoingLinks(
  activeNote: Note | undefined,
  notes: Note[],
  folders: Folder[] = [],
): OutgoingLinks {
  if (!activeNote) return { resolved: [], unresolvedTitles: [] };

  const index = buildLinkIndex(notes, folders);
  const idToNote = new Map(notes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const resolved: Note[] = [];
  const unresolvedTitles: string[] = [];

  (activeNote.links ?? []).forEach((target) => {
    const id = resolveLinkTarget(target, index, activeNote.folder ?? '');
    if (!id) {
      unresolvedTitles.push(target);
      return;
    }
    if (id === activeNote.id || seen.has(id)) return;
    const note = idToNote.get(id);
    if (!note) return;
    seen.add(id);
    resolved.push(note);
  });

  return { resolved, unresolvedTitles };
}

export function useOutgoingLinks(
  activeNote: Note | undefined,
  notes: Note[],
  folders: Folder[] = [],
): OutgoingLinks {
  return useMemo(() => computeOutgoingLinks(activeNote, notes, folders), [activeNote, notes, folders]);
}
