export const RIGHT_TABS = ['tasks', 'backlinks', 'outgoing', 'graph', 'properties'] as const;

export type RightTab = typeof RIGHT_TABS[number];

export const DEFAULT_RIGHT_TAB: RightTab = 'tasks';

export function isRightTab(value: unknown): value is RightTab {
  return typeof value === 'string' && (RIGHT_TABS as readonly string[]).includes(value);
}
