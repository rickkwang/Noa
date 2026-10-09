export const RIGHT_TABS = ['tasks', 'backlinks', 'outgoing', 'graph', 'properties'] as const;

/** The titlebar menu that switches right-column cards on and off. */
export const TITLEBAR_PANEL_TABS_SLOT_ID = 'noa-titlebar-panel-tabs';

export type RightTab = typeof RIGHT_TABS[number];

export const DEFAULT_RIGHT_TAB: RightTab = 'tasks';

export function isRightTab(value: unknown): value is RightTab {
  return typeof value === 'string' && (RIGHT_TABS as readonly string[]).includes(value);
}

export const RIGHT_TAB_LABELS: Record<RightTab, string> = {
  tasks: 'Tasks',
  backlinks: 'Backlinks',
  outgoing: 'Outgoing',
  graph: 'Graph',
  properties: 'Properties',
};

/** Counts on the card switches; computed outside the lazy panel so the titlebar can show them before it loads. */
export interface PaneBadges {
  backlinks: number;
  outgoing: number;
  tasks: number;
}
