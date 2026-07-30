import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const themeInjectorPath = fileURLToPath(new URL('../../src/components/ThemeInjector.tsx', import.meta.url));
const previewPanePath = fileURLToPath(new URL('../../src/components/editor/PreviewPane.tsx', import.meta.url));
const rightPanelPath = fileURLToPath(new URL('../../src/components/RightPanel.tsx', import.meta.url));
const editorHeaderPath = fileURLToPath(new URL('../../src/components/editor/EditorHeader.tsx', import.meta.url));
const topBarPath = fileURLToPath(new URL('../../src/components/TopBar.tsx', import.meta.url));
const indexCssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));
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
    expect(rightPanel).toContain('h-10 shrink-0 flex items-center px-2');
    expect(rightPanel).toContain('flex-1 flex-col overflow-hidden px-2 pb-2 pt-0 gap-2');
    expect(rightPanel).toContain('w-full flex items-stretch gap-0.5 rounded-md p-0.5');
    expect(rightPanel).toContain("background: isDark ? '#252523' : '#ECEAE6'");
    expect(rightPanel).toContain(": 'inset 0 0 0 1px var(--divider-subtle, #E6E2DA)'");
    expect(rightPanel).toContain('flex-1 flex items-center justify-center h-6 rounded-md');
    expect(rightPanel).toContain(": '0 1px 2px rgba(45,45,43,0.1), 0 0 0 1px rgba(45,45,43,0.04)'");
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

  it('keeps the tab strip on the editor canvas instead of a separate tinted surface', async () => {
    const editorHeader = await readFile(editorHeaderPath, 'utf8');

    expect(editorHeader).toContain("isDark ? 'bg-[#2D2D2B] after:bg-[#F9F9F7]/15' : 'bg-[#F9F9F7] after:bg-[#E6E2DA]'");
  });

  it('starts the lifted tab-strip baseline after the open desktop sidebar', async () => {
    const topBar = await readFile(topBarPath, 'utf8');

    expect(topBar).not.toContain('after:inset-x-0');
    expect(topBar).toContain("!isMobile && isSidebarOpen ? 'after:left-[var(--noa-sidebar-width,310px)]' : 'after:left-0'");
    expect(topBar).toContain('after:absolute after:right-0 after:bottom-0 after:h-px');
    expect(topBar).toContain("isDark ? 'after:bg-[#F9F9F7]/15' : 'after:bg-[#E6E2DA]'");
  });

  it('keeps the active version-history control vertically compact', async () => {
    const editorHeader = await readFile(editorHeaderPath, 'utf8');

    expect(editorHeader).toContain("className={`px-1.5 py-1 rounded-md active:opacity-70 transition-colors shrink-0 ${isHistoryOpen");
  });

  it('cycles editor view modes through one next-mode icon', async () => {
    const editorHeader = await readFile(editorHeaderPath, 'utf8');

    expect(editorHeader).not.toContain('rounded-lg p-0.5 border');
    expect(editorHeader).not.toContain('shadow-[inset_0_1px_2px');
    expect(editorHeader).toContain('h-4 w-px shrink-0');
    expect(editorHeader).not.toContain('formatRelativeTime(note.updatedAt)');
    expect(editorHeader).toContain("const nextViewMode = viewMode === 'edit' ? 'split' : viewMode === 'split' ? 'preview' : 'edit';");
    expect(editorHeader).toContain('onClick={() => setViewMode(nextViewMode)}');
    expect(editorHeader).toContain('aria-label={`Switch to ${nextViewModeLabel} view`}');
    expect(editorHeader).toContain("const NextViewModeIcon = nextViewMode === 'edit' ? Edit2 : nextViewMode === 'split' ? Columns : Eye;");
    expect(editorHeader).toContain('<NextViewModeIcon size={14} />');
    expect(editorHeader).not.toContain('<ViewModeIcon size={14} />');
    expect(editorHeader).not.toContain('aria-label="Edit only"');
    expect(editorHeader).not.toContain('aria-label="Split view"');
    expect(editorHeader).not.toContain('aria-label="Preview only"');
    expect(editorHeader).toContain('className={`flex items-center p-1 active:opacity-70 transition-colors ${open');
    expect(editorHeader).toContain('shrink-0 translate-x-[10px] whitespace-nowrap');
    expect(editorHeader).toContain("const noDragRegion: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' };");
    expect(editorHeader).toContain('style={noDragRegion}');
  });

  it('uses the shared divider for the compact title-bar search without an accent focus ring', async () => {
    const [topBar, indexCss] = await Promise.all([
      readFile(topBarPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    expect(topBar).toContain("'var(--divider-subtle, #E6E2DA)'");
    expect(topBar).toContain('noa-titlebar-search-input');
    expect(indexCss).toContain('.noa-titlebar-search-input:focus-visible');
    expect(topBar).not.toContain('shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)]');
  });

  it('keeps one fixed search icon while adding a compact frame on demand', async () => {
    const topBar = await readFile(topBarPath, 'utf8');

    expect(topBar).toContain('title="Search notes"');
    expect(topBar).toContain('aria-label="Search notes"');
    expect(topBar).toContain('<div aria-hidden="true" className="min-w-0" />');
    expect(topBar).toContain('aria-pressed={isSearchOpen}');
    expect(topBar).toContain('placeholder="Search notes, tags..."');
    expect(topBar).toContain('h-7 min-w-7');
    expect(topBar).toContain('h-7 w-7 shrink-0');
    expect(topBar).toContain('<Search size={16}');
    expect(topBar).not.toContain('<Search size={14}');
    expect(topBar).not.toContain('fixed inset-0 z-[75]');
  });

  it('keeps the sidebar separator off-canvas after collapse without a duplicate title-bar baseline', async () => {
    const [topBar, app] = await Promise.all([
      readFile(topBarPath, 'utf8'),
      readFile(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8'),
    ]);

    expect(topBar).not.toContain('className="h-8 border-b grid');
    expect(topBar).not.toContain('className="pointer-events-none absolute bottom-0 right-0 h-px transition-[left]"');
    expect(app).toContain('className="flex-1 flex min-h-0 overflow-visible relative"');
    expect(app).toContain('className="pointer-events-none absolute top-0 bottom-0 z-20"');
    expect(app).toContain("left: isSidebarOpen ? 'var(--noa-sidebar-width, 310px)' : '-1px'");
    expect(app).toContain("right: isRightPanelOpen ? 'var(--noa-right-panel-width, 310px)' : '-1px'");
    expect(app).not.toContain('borderRightWidth: isFocusMode ? 0 : 1');
    expect(app).not.toContain('borderLeftWidth: isFocusMode ? 0 : 1');
  });

  it('reserves the macOS window-control area when lifted tabs have no sidebar beside them', async () => {
    const [topBar, editorHeader, editor, app] = await Promise.all([
      readFile(topBarPath, 'utf8'),
      readFile(editorHeaderPath, 'utf8'),
      readFile(fileURLToPath(new URL('../../src/components/Editor.tsx', import.meta.url)), 'utf8'),
      readFile(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8'),
    ]);

    expect(topBar).toContain('relative z-30 flex min-w-0 items-center gap-0.5');
    expect(editorHeader).toContain('reserveTitlebarTraffic?: boolean;');
    expect(editorHeader).toContain('reserveTitlebarTraffic = false,');
    expect(editorHeader).toContain("paddingLeft: liftTabStrip && reserveTitlebarTraffic ? '9rem' : '0.25rem'");
    expect(editorHeader).toContain("paddingRight: reserveTitlebarActions ? '7.25rem' : '0.5rem'");
    expect(editorHeader).toContain("transition: liftTabStrip ? 'padding 220ms cubic-bezier(0.4, 0, 0.2, 1)' : undefined");
    expect(editor).toContain('reserveTitlebarTraffic?: boolean;');
    expect(editor).toContain('reserveTitlebarTraffic={reserveTitlebarTraffic}');
    expect(app).toContain('reserveTitlebarTraffic={!isMobile && !isFocusMode && !isSidebarOpen}');
  });

  it('slides fixed-width side panels instead of cropping them with width animation', async () => {
    const app = await readFile(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8');

    expect(app).toContain("marginLeft: !isMobile && (isFocusMode || !isSidebarOpen) ? 'calc(-1 * var(--noa-sidebar-width, 310px))' : '0px'");
    expect(app).toContain("transition: isDraggingSidebar ? 'none' : (isMobile ? 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)' : 'margin-left 220ms cubic-bezier(0.4, 0, 0.2, 1)')");
    expect(app).toContain("marginRight: !isMobile && (isFocusMode || !isRightPanelOpen) ? 'calc(-1 * var(--noa-right-panel-width, 310px))' : '0px'");
    expect(app).toContain("transition: isDraggingRightPanel ? 'none' : (isMobile ? 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)' : 'margin-right 220ms cubic-bezier(0.4, 0, 0.2, 1)')");
    expect(app).not.toContain("transition: isDraggingSidebar ? 'none' : 'width 220ms");
    expect(app).not.toContain("transition: isDraggingRightPanel ? 'none' : 'width 220ms");
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
