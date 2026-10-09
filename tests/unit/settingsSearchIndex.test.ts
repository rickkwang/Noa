import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SETTINGS_INDEX, searchSettings, settingAnchorId } from '../../src/components/settings/settingsIndex';

const SECTION_SOURCES = [
  '../../src/components/settings/sections/WritingSettings.tsx',
  '../../src/components/settings/sections/AppearanceSettings.tsx',
  '../../src/components/settings/sections/AppUpdateSettings.tsx',
  '../../src/components/settings/sections/data/WorkspaceSection.tsx',
  '../../src/components/settings/sections/data/BackupSection.tsx',
  '../../src/components/settings/sections/data/AutoBackupSection.tsx',
  '../../src/components/settings/sections/data/ImportSection.tsx',
];

async function renderedSettingLabels(): Promise<string[]> {
  const sources = await Promise.all(
    SECTION_SOURCES.map((rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')),
  );
  // Matches both the one-line and multi-line <SettingItem label="…"> forms.
  const labels = sources.flatMap((source) => [
    ...source.matchAll(/<SettingItem[\s\n]+[^>]*?label="([^"]+)"/g),
  ].map((match) => match[1]));
  return [...new Set(labels)].sort();
}

describe('settings search index', () => {
  it('covers every setting the panel renders, and nothing it does not', async () => {
    // Only the active tab mounts, so check the index against the sources, not the DOM.
    // The shortcut table is indexed but is not a SettingItem.
    const anchoredSections = ['Keyboard Shortcuts'];
    const rendered = [...(await renderedSettingLabels()), ...anchoredSections].sort();
    const indexed = [...new Set(SETTINGS_INDEX.map((entry) => entry.label))].sort();

    expect(indexed).toEqual(rendered);
  });

  it('gives every entry a unique anchor that SettingItem can reproduce', () => {
    const anchors = SETTINGS_INDEX.map((entry) => settingAnchorId(entry.label));
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(settingAnchorId('Backup & Import')).toBe('setting-backup-import');
    expect(settingAnchorId('Use Pointer Cursors')).toBe('setting-use-pointer-cursors');
  });

  it('matches on label, section, and keyword, and returns nothing when empty', () => {
    expect(searchSettings('')).toHaveLength(0);
    expect(searchSettings('   ')).toHaveLength(0);

    expect(searchSettings('line height').map((e) => e.label)).toContain('Line Height');
    // Section names match too.
    expect(searchSettings('typography').map((e) => e.label)).toEqual(['Font Family', 'Font Size']);
    // Keywords match even when absent from the label.
    expect(searchSettings('dark').map((e) => e.label)).toContain('Base Theme');
    expect(searchSettings('obsidian').map((e) => e.label)).toContain('Import Vault Folder');
    // Keyword tokens are upper-case in the index; matching is case-insensitive.
    expect(searchSettings('yyyy').map((e) => e.label)).toContain('Date Format');
  });
});
