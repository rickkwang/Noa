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
  // <SettingItem label="X" …> on one line, and the multi-line form where label
  // sits on its own line under the tag.
  const labels = sources.flatMap((source) => [
    ...source.matchAll(/<SettingItem[\s\n]+[^>]*?label="([^"]+)"/g),
  ].map((match) => match[1]));
  return [...new Set(labels)].sort();
}

describe('settings search index', () => {
  it('covers every setting the panel renders, and nothing it does not', async () => {
    // A hand-written index goes stale silently; this is the guard. Only the
    // active tab is ever mounted, so the index cannot be built from the DOM —
    // it has to be checked against the sources instead.
    const rendered = await renderedSettingLabels();
    const indexed = [...new Set(SETTINGS_INDEX.map((entry) => entry.label))].sort();

    expect(indexed).toEqual(rendered);
  });

  it('gives every entry a unique anchor that SettingItem can reproduce', () => {
    const anchors = SETTINGS_INDEX.map((entry) => settingAnchorId(entry.label));
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(settingAnchorId('Backup & Import')).toBe('setting-backup-import');
    expect(settingAnchorId('Use pointer cursors')).toBe('setting-use-pointer-cursors');
  });

  it('matches on label, section, and keyword, and returns nothing when empty', () => {
    expect(searchSettings('')).toHaveLength(0);
    expect(searchSettings('   ')).toHaveLength(0);

    expect(searchSettings('line height').map((e) => e.label)).toContain('Line Height');
    // Section name: someone typing "typography" wants everything under it.
    expect(searchSettings('typography').map((e) => e.label)).toEqual(['Font Family', 'Font Size']);
    // Keyword: the word a person actually types is not in the label.
    expect(searchSettings('dark').map((e) => e.label)).toContain('Base Theme');
    expect(searchSettings('obsidian').map((e) => e.label)).toContain('Import Vault Folder');
    // Keywords hold upper-case tokens; a person types them lower case.
    expect(searchSettings('yyyy').map((e) => e.label)).toContain('Date Format');
  });
});
