import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const themeInjectorPath = fileURLToPath(new URL('../../src/components/ThemeInjector.tsx', import.meta.url));
const previewPanePath = fileURLToPath(new URL('../../src/components/editor/PreviewPane.tsx', import.meta.url));
const rightPanelPath = fileURLToPath(new URL('../../src/components/RightPanel.tsx', import.meta.url));
const editorHeaderPath = fileURLToPath(new URL('../../src/components/editor/EditorHeader.tsx', import.meta.url));
const topBarPath = fileURLToPath(new URL('../../src/components/TopBar.tsx', import.meta.url));
const settingsModalPath = fileURLToPath(new URL('../../src/components/settings/SettingsModal.tsx', import.meta.url));
const settingsSidebarPath = fileURLToPath(new URL('../../src/components/settings/SettingsSidebar.tsx', import.meta.url));
const settingItemPath = fileURLToPath(new URL('../../src/components/settings/SettingItem.tsx', import.meta.url));
const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));
const tocPanelPath = fileURLToPath(new URL('../../src/components/editor/TocPanel.tsx', import.meta.url));
const slashCommandPath = fileURLToPath(new URL('../../src/components/editor/SlashCommandDropdown.tsx', import.meta.url));
const mentionDropdownPath = fileURLToPath(new URL('../../src/components/editor/MentionDropdown.tsx', import.meta.url));
const findReplacePath = fileURLToPath(new URL('../../src/components/editor/FindReplacePanel.tsx', import.meta.url));
const historyPanelPath = fileURLToPath(new URL('../../src/components/editor/HistoryPanel.tsx', import.meta.url));
const graphViewPath = fileURLToPath(new URL('../../src/components/GraphView.tsx', import.meta.url));

describe('light theme border tokens', () => {
  it('uses one fine warm-gray divider instead of near-black structural borders', async () => {
    const source = await readFile(themeInjectorPath, 'utf8');

    expect(source).toContain("root.style.setProperty('--divider-subtle', '#E6E2DA');");
    expect(source).toContain("root.style.setProperty('--border-default', 'var(--divider-subtle)');");
    expect(source).toContain("root.style.setProperty('--border-strong', '#E6E2DA');");
    expect(source).not.toContain("root.style.setProperty('--border-primary', '#2D2D2B');");
  });

  it('keeps preview tables and graph cards at the default border weight', async () => {
    const [previewPane, rightPanel] = await Promise.all([
      readFile(previewPanePath, 'utf8'),
      readFile(rightPanelPath, 'utf8'),
    ]);

    expect(previewPane).toContain("var(--divider-subtle, #E6E2DA)");
    expect(previewPane).not.toContain("rgba(45,45,43,0.2)");
    expect(previewPane).not.toContain("var(--border-strong, #AAA397)");
    expect(previewPane).toContain("linear-gradient(to bottom, transparent 0, black 48px)");
    expect(rightPanel).not.toContain("border-[#2D2D2B]/90 bg-[#F9F9F7]");
    expect(rightPanel).not.toContain("border-[#2D2D2B]}`");
    expect(rightPanel).toContain("'var(--divider-subtle, #E6E2DA)'");
    expect(rightPanel).not.toContain("'rgba(45,45,43,0.1)'");
    expect(rightPanel).toContain('h-8 shrink-0 border-b flex items-center pl-1 pr-[5px]');
    expect(rightPanel).toContain('flex-1 flex items-center justify-center h-7 rounded-md');
    expect(rightPanel).not.toContain(": '0 0 2px rgba(45,45,43,0.12)'");
  });

  it('uses the shared divider for linked-mention separators and cards', async () => {
    const previewPane = await readFile(previewPanePath, 'utf8');

    expect(previewPane).toContain("borderTop: '1px dashed var(--divider-subtle, #E6E2DA)'");
    expect(previewPane).toContain("border: '1px solid var(--divider-subtle, #E6E2DA)'");
  });

  it('uses a subtle baseline beneath the editor tab strip', async () => {
    const editorHeader = await readFile(editorHeaderPath, 'utf8');

    expect(editorHeader).toContain("after:bg-[#E6E2DA]");
    expect(editorHeader).toContain("bg-[#E6E2DA]");
    expect(editorHeader).not.toContain("after:bg-[#2D2D2B]'}");
  });

  it('keeps the active version-history control vertically compact', async () => {
    const editorHeader = await readFile(editorHeaderPath, 'utf8');

    expect(editorHeader).toContain("className={`px-1.5 py-1 rounded-md active:opacity-70 transition-colors shrink-0 ${isHistoryOpen");
  });

  it('keeps the search field defined by its border rather than an inset shadow', async () => {
    const topBar = await readFile(topBarPath, 'utf8');

    expect(topBar).toContain("isDark ? 'var(--panel-divider, rgba(249,249,247,0.15))' : 'var(--border-default, #E6E2DA)'");
    expect(topBar).not.toContain('shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)]');
  });

  it('uses fine shared borders for settings chrome and floating utilities', async () => {
    const [settingsModal, settingsSidebar, settingItem, sidebar, tocPanel, slashCommand, mentionDropdown] = await Promise.all([
      readFile(settingsModalPath, 'utf8'),
      readFile(settingsSidebarPath, 'utf8'),
      readFile(settingItemPath, 'utf8'),
      readFile(sidebarPath, 'utf8'),
      readFile(tocPanelPath, 'utf8'),
      readFile(slashCommandPath, 'utf8'),
      readFile(mentionDropdownPath, 'utf8'),
    ]);

    for (const source of [settingsModal, settingsSidebar, settingItem, sidebar, tocPanel, slashCommand, mentionDropdown]) {
      expect(source).not.toContain('border-[1.75px]');
    }
    expect(settingsModal).not.toContain('border-2 border-[#2D2D2B]');
    expect(sidebar).not.toContain('border-2 border-[#2D2D2B]');
    expect(tocPanel).not.toContain('border-2 border-[#2D2D2B]');
  });

  it('routes remaining utility dividers through the shared light token', async () => {
    const [findReplace, historyPanel, graphView] = await Promise.all([
      readFile(findReplacePath, 'utf8'),
      readFile(historyPanelPath, 'utf8'),
      readFile(graphViewPath, 'utf8'),
    ]);

    expect(findReplace).toContain("const border = 'var(--divider-subtle, #E6E2DA)'");
    expect(historyPanel).toContain("const border = 'var(--divider-subtle, #E6E2DA)'");
    expect(graphView).toContain("border: '1px solid var(--divider-subtle, #E6E2DA)'");
  });

  it('uses soft elevation instead of hard offset outlines for floating surfaces', async () => {
    const [themeInjector, app, sidebar, tocPanel] = await Promise.all([
      readFile(themeInjectorPath, 'utf8'),
      readFile(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8'),
      readFile(sidebarPath, 'utf8'),
      readFile(tocPanelPath, 'utf8'),
    ]);

    expect(themeInjector).toContain('box-shadow: 0 4px 12px 0 color-mix(in srgb, var(--border-strong) 28%, transparent)');
    expect(themeInjector).not.toContain('box-shadow: 4px 4px 0 0 var(--border-strong)');
    for (const source of [app, sidebar, tocPanel]) {
      expect(source).not.toContain('shadow-[4px_4px_0px_0px');
    }
  });
});
