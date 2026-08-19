/**
 * Pure data: the tab ids and what setting sits on each of them. No React and no
 * icons — the sidebar owns those and maps them onto these ids, which keeps this
 * module importable from a plain unit test and the dependency running one way.
 */
export const SETTINGS_TAB_IDS = ['general', 'notes', 'appearance', 'workspace', 'data', 'about'] as const;

export type SettingsTab = typeof SETTINGS_TAB_IDS[number];

export interface SettingsIndexEntry {
  /** Tab the setting lives on. */
  tab: SettingsTab;
  /** Section heading above it, shown as the result's context line. */
  section: string;
  /** The setting's own label, matched verbatim against SettingItem's. */
  label: string;
  /** Words a person might search that the label does not contain. */
  keywords?: string;
}

/**
 * What the settings search actually searches. Hand-written rather than derived
 * at runtime: only the active tab is mounted, so there is no DOM to read for
 * the five tabs a person has not opened.
 *
 * `tests/unit/settingsSearchIndex.test.ts` parses every `<SettingItem label=…>`
 * out of the section sources and fails if this list drifts from them, which is
 * the part a hand-written index normally gets wrong.
 *
 * Keywords carry the vocabulary the labels do not: someone looking for dark
 * mode types "dark", not "base theme".
 */
export const SETTINGS_INDEX: readonly SettingsIndexEntry[] = [
  // General
  { tab: 'general', section: 'Editor', label: 'View Mode', keywords: 'edit split preview pane layout' },
  { tab: 'general', section: 'Search', label: 'Fuzzy Search', keywords: 'approximate typo partial matching' },
  { tab: 'general', section: 'Search', label: 'Case Sensitive', keywords: 'uppercase lowercase matching' },

  // Notes
  { tab: 'notes', section: 'Daily Notes', label: 'Enable Daily Notes', keywords: 'journal today toolbar' },
  { tab: 'notes', section: 'Daily Notes', label: 'Date Format', keywords: 'filename pattern YYYY MM DD' },
  { tab: 'notes', section: 'Daily Notes', label: 'Template', keywords: 'daily note body starting content' },

  // Appearance
  { tab: 'appearance', section: 'Theme', label: 'Base Theme', keywords: 'dark light system appearance colour color' },
  { tab: 'appearance', section: 'Theme', label: 'Translucent sidebar', keywords: 'frosted glass blur material vibrancy' },
  { tab: 'appearance', section: 'Typography', label: 'Font Family', keywords: 'typeface serif mono' },
  { tab: 'appearance', section: 'Typography', label: 'Font Size', keywords: 'text bigger smaller zoom' },
  { tab: 'appearance', section: 'Reading', label: 'Line Height', keywords: 'leading spacing' },
  { tab: 'appearance', section: 'Reading', label: 'Max Width', keywords: 'measure column line length' },
  { tab: 'appearance', section: 'Reading', label: 'Use pointer cursors', keywords: 'hand mouse hover' },

  // Workspace
  { tab: 'workspace', section: 'Workspace', label: 'Workspace Name', keywords: 'rename label title' },
  { tab: 'workspace', section: 'Workspace', label: 'Import Vault Folder', keywords: 'obsidian migrate markdown folder' },
  { tab: 'workspace', section: 'Workspace', label: 'New Workspace', keywords: 'create empty fresh' },
  { tab: 'workspace', section: 'Workspace', label: 'Vault Folder', keywords: 'connect sync disk markdown mirror' },

  // Data
  { tab: 'data', section: 'Backup', label: 'Export JSON Backup', keywords: 'download save archive' },
  { tab: 'data', section: 'Backup', label: 'Export Vault', keywords: 'markdown files download zip' },
  { tab: 'data', section: 'Backup', label: 'Export as HTML', keywords: 'download share print' },
  { tab: 'data', section: 'Automatic backup', label: 'Backup folder', keywords: 'daily snapshot directory disk' },
  { tab: 'data', section: 'Automatic backup', label: 'Last automatic backup', keywords: 'when ran history' },
  { tab: 'data', section: 'Automatic backup', label: 'Retention', keywords: 'keep delete old files how many' },
  { tab: 'data', section: 'Import', label: 'Import JSON', keywords: 'restore backup load' },

  // About
  { tab: 'about', section: 'App Update', label: 'Current Version', keywords: 'build number release' },
  { tab: 'about', section: 'App Update', label: 'Update Status', keywords: 'check download install upgrade' },
];

/** Stable DOM id for a setting, shared by the index and SettingItem. */
export function settingAnchorId(label: string): string {
  return `setting-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

export function searchSettings(query: string): SettingsIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Every side is lowered: keywords carry things like "YYYY MM DD", which a
  // person types in lower case.
  return SETTINGS_INDEX.filter((entry) =>
    entry.label.toLowerCase().includes(q)
    || entry.section.toLowerCase().includes(q)
    || (entry.keywords?.toLowerCase().includes(q) ?? false));
}
