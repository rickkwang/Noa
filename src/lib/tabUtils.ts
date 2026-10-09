export const MAX_OPEN_TABS = 20;

/**
 * Append a tab, evicting the leftmost (non-`id`) tab at capacity. Returns the
 * same array reference when the tab is already open.
 */
export function addTabId(openTabIds: string[], id: string, maxTabs: number = MAX_OPEN_TABS): string[] {
  if (openTabIds.includes(id)) return openTabIds;
  if (openTabIds.length < maxTabs) return [...openTabIds, id];
  const dropIndex = openTabIds.findIndex((tabId) => tabId !== id);
  if (dropIndex === -1) return [id];
  return [...openTabIds.slice(0, dropIndex), ...openTabIds.slice(dropIndex + 1), id];
}

/**
 * Remove a tab and decide the next active tab: prefer the tab to the right,
 * fall back to the left. `nextActive` is null when the active tab is
 * unaffected; '' means the last tab closed and the selection must be cleared.
 */
export function removeTabAndPickNext(
  openTabIds: string[],
  closingId: string,
  activeNoteId: string,
): { next: string[]; nextActive: string | null } {
  const idx = openTabIds.indexOf(closingId);
  if (idx === -1) return { next: openTabIds, nextActive: null };
  const next = openTabIds.filter((tabId) => tabId !== closingId);
  if (closingId !== activeNoteId) return { next, nextActive: null };
  if (next.length === 0) return { next, nextActive: '' };
  return { next, nextActive: next[idx] ?? next[idx - 1] };
}

/** Move `sourceId` next to `targetId`; returns the original array when nothing changes. */
export function moveTabId(openTabIds: string[], sourceId: string, targetId: string, after: boolean): string[] {
  if (sourceId === targetId || !openTabIds.includes(sourceId) || !openTabIds.includes(targetId)) return openTabIds;
  const next = openTabIds.filter((id) => id !== sourceId);
  next.splice(next.indexOf(targetId) + Number(after), 0, sourceId);
  return next.every((id, index) => id === openTabIds[index]) ? openTabIds : next;
}
