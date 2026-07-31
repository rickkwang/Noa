export const RIGHT_TABS = ['tasks', 'backlinks', 'outgoing', 'graph', 'properties'] as const;

/** Titlebar slot RightPanel portals its tab strip into on desktop. */
export const TITLEBAR_PANEL_TABS_SLOT_ID = 'noa-titlebar-panel-tabs';

export type RightTab = typeof RIGHT_TABS[number];

export const DEFAULT_RIGHT_TAB: RightTab = 'tasks';

export function isRightTab(value: unknown): value is RightTab {
  return typeof value === 'string' && (RIGHT_TABS as readonly string[]).includes(value);
}
