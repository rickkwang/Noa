import { useMemo, useRef } from 'react';
import type { PaneBadges } from '../constants/rightTabs';
import { computeTopologySignature, getBacklinks } from '../lib/noteUtils';
import type { Folder, GlobalTask, Note } from '../types';
import { computeOutgoingLinks } from './useOutgoingLinks';

/**
 * Counts for the titlebar card switches. Lives here, not in RightPanel, since the switches show before the lazy panel
 * mounts. Keyed on the structural topology signature, so content-only keystrokes skip the recompute.
 */
export function usePaneBadges(
  notes: Note[],
  folders: Folder[],
  activeNoteId: string | null | undefined,
  tasks: GlobalTask[],
): PaneBadges {
  const topologyKey = useMemo(() => computeTopologySignature(notes, folders), [notes, folders]);
  const stableRef = useRef<{ key: string; notes: Note[]; folders: Folder[] }>({ key: '', notes: [], folders: [] });
  if (stableRef.current.key !== topologyKey) {
    stableRef.current = { key: topologyKey, notes, folders };
  }
  const topologyNotes = stableRef.current.notes;
  const topologyFolders = stableRef.current.folders;

  const links = useMemo(() => {
    const active = activeNoteId ? topologyNotes.find((n) => n.id === activeNoteId) : undefined;
    return {
      backlinks: getBacklinks(active, topologyNotes).length,
      outgoing: computeOutgoingLinks(active, topologyNotes, topologyFolders).resolved.length,
    };
  }, [topologyNotes, topologyFolders, activeNoteId]);
  const pendingTasks = useMemo(() => tasks.filter((t) => !t.completed).length, [tasks]);

  return useMemo(() => ({ ...links, tasks: pendingTasks }), [links, pendingTasks]);
}
