import { DEFAULT_RIGHT_TAB, isRightTab, type RightTab } from '../constants/rightTabs';

/** Two cards share the right column; a third would leave each under 250px tall. */
export const MAX_OPEN_PANES = 2;

export interface PaneState {
  /** Whether the right column is showing at all. */
  open: boolean;
  /** Cards in the column, oldest first. Never empty, so the column always has
   *  something to restore when it is reopened as a whole. */
  panes: readonly RightTab[];
}

/**
 * A titlebar icon is a switch for its own card, not a tab selector.
 *
 * Closing the last card collapses the column but keeps that card remembered,
 * and an icon pressed while the column is collapsed opens it on that card
 * alone — the icon says "show me this", not "add this to whatever was there".
 */
export function togglePane(state: PaneState, id: RightTab): PaneState {
  if (!state.open) return { open: true, panes: [id] };
  if (state.panes.includes(id)) {
    if (state.panes.length === 1) return { open: false, panes: state.panes };
    return { open: true, panes: state.panes.filter((pane) => pane !== id) };
  }
  return { open: true, panes: [...state.panes, id].slice(-MAX_OPEN_PANES) };
}

/** Reads the persisted card list, falling back to the single tab the panel
 *  stored before it could show more than one. */
export function parseOpenPanes(saved: string | null, legacyTab: string | null): RightTab[] {
  if (saved) {
    try {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const panes = [...new Set(parsed.filter(isRightTab))].slice(-MAX_OPEN_PANES);
        if (panes.length > 0) return panes;
      }
    } catch {
      // Unreadable value: fall through to the legacy key.
    }
  }
  return [isRightTab(legacyTab) ? legacyTab : DEFAULT_RIGHT_TAB];
}
