import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const themeInjectorPath = fileURLToPath(new URL('../../src/components/ThemeInjector.tsx', import.meta.url));
const previewPanePath = fileURLToPath(new URL('../../src/components/editor/PreviewPane.tsx', import.meta.url));
const rightPanelPath = fileURLToPath(new URL('../../src/components/RightPanel.tsx', import.meta.url));
const editorHeaderPath = fileURLToPath(new URL('../../src/components/editor/EditorHeader.tsx', import.meta.url));
const editorActionsPath = fileURLToPath(new URL('../../src/components/editor/EditorActions.tsx', import.meta.url));
const topBarPath = fileURLToPath(new URL('../../src/components/TopBar.tsx', import.meta.url));
const indexCssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));
const settingsModalPath = fileURLToPath(new URL('../../src/components/settings/SettingsModal.tsx', import.meta.url));
const settingsSidebarPath = fileURLToPath(new URL('../../src/components/settings/SettingsSidebar.tsx', import.meta.url));
const settingSectionPath = fileURLToPath(new URL('../../src/components/settings/SettingSection.tsx', import.meta.url));
const settingItemPath = fileURLToPath(new URL('../../src/components/settings/SettingItem.tsx', import.meta.url));
const dataSettingsPath = fileURLToPath(new URL('../../src/components/settings/sections/DataSettings.tsx', import.meta.url));
const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));
const tocPanelPath = fileURLToPath(new URL('../../src/components/editor/TocPanel.tsx', import.meta.url));
const slashCommandPath = fileURLToPath(new URL('../../src/components/editor/SlashCommandDropdown.tsx', import.meta.url));
const mentionDropdownPath = fileURLToPath(new URL('../../src/components/editor/MentionDropdown.tsx', import.meta.url));
const findReplacePath = fileURLToPath(new URL('../../src/components/editor/FindReplacePanel.tsx', import.meta.url));
const historyPanelPath = fileURLToPath(new URL('../../src/components/editor/HistoryPanel.tsx', import.meta.url));
const graphViewPath = fileURLToPath(new URL('../../src/components/GraphView.tsx', import.meta.url));

describe('light theme border tokens', () => {
  it('uses one translucent divider recipe across both themes and primary separators', async () => {
    const [themeInjector, editorHeader, topBar, previewPane] = await Promise.all([
      readFile(themeInjectorPath, 'utf8'),
      readFile(editorHeaderPath, 'utf8'),
      readFile(topBarPath, 'utf8'),
      readFile(previewPanePath, 'utf8'),
    ]);

    const sharedDividerRecipe = "root.style.setProperty('--divider-subtle', 'color-mix(in srgb, var(--text-primary) 8%, transparent)');";
    expect(themeInjector.split(sharedDividerRecipe)).toHaveLength(3);
    expect(themeInjector).not.toContain("root.style.setProperty('--divider-subtle', '#E6E2DA');");
    expect(themeInjector).not.toContain("root.style.setProperty('--divider-subtle', 'rgba(249,249,247,0.15)');");
    expect(editorHeader).toContain('after:bg-[var(--divider-subtle)]');
    expect(editorHeader).toContain('editor-tab-divider self-center h-3.5 w-px shrink-0 bg-[var(--divider-subtle)]');
    expect(topBar).toContain('after:bg-[var(--divider-subtle)]');
    expect(previewPane).toContain("const borderColor = 'var(--divider-subtle, #E6E2DA)';");
  });

  it('routes structural lines through the shared divider without flattening interactive utilities', async () => {
    const [themeInjector, indexCss, editorToolbar, rightPanel] = await Promise.all([
      readFile(themeInjectorPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
      readFile(new URL('../../src/components/editor/EditorToolbar.tsx', import.meta.url), 'utf8'),
      readFile(rightPanelPath, 'utf8'),
    ]);

    expect(themeInjector).not.toContain('background-color: var(--divider-subtle) !important;');
    expect(themeInjector).not.toContain('.border-\\[\\#2D2D2B\\]\\/20 { border-color: var(--divider-subtle) !important; }');
    expect(themeInjector).not.toContain('.border-\\[\\#2D2D2B\\]\\/40 { border-color: var(--border-strong) !important; }');
    expect(themeInjector).not.toContain('.hover\\:border-\\[\\#2D2D2B\\]:hover { border-color: var(--border-strong) !important; }');
    expect(indexCss).toContain('[data-theme="dark"] .border-\\[\\#2D2D2B\\]\\/40  { border-color: rgba(249,249,247,0.30) !important; }');
    expect(indexCss).toContain('[data-theme="dark"] .hover\\:border-\\[\\#2D2D2B\\]\\/50:hover { border-color: rgba(249,249,247,0.38) !important; }');
    expect(editorToolbar).toContain('w-px h-4 bg-[var(--divider-subtle)]');
    expect(rightPanel).toContain("const borderCol = 'var(--divider-subtle, #E6E2DA)';");
  });

  it('scopes all ordinary settings-panel borders to the divider token', async () => {
    const [settingsModal, settingsSidebar, settingSection, settingItem, dataSettings, indexCss] = await Promise.all([
      readFile(settingsModalPath, 'utf8'),
      readFile(settingsSidebarPath, 'utf8'),
      readFile(settingSectionPath, 'utf8'),
      readFile(settingItemPath, 'utf8'),
      readFile(dataSettingsPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    expect(settingsModal).toContain('bg-[#F9F9F7] border border-[var(--divider-subtle)]');
    expect(settingsModal).toContain('h-10 border-b border-[var(--divider-subtle)]');
    expect(settingsModal).toContain('className="border border-[var(--divider-subtle)] rounded overflow-hidden"');
    expect(settingsSidebar).toContain('border-b border-[var(--divider-subtle)]');
    expect(settingSection).toContain('bg-[#EFEAE3] border border-[var(--divider-subtle)]');
    expect(settingItem.split('border-b border-[var(--divider-subtle)]')).toHaveLength(3);

    expect(settingsModal).toContain('data-settings-surface="true"');
    expect(indexCss).toContain('[data-settings-surface="true"] .border-\\[\\#2D2D2B\\]');
    expect(indexCss).toContain('[data-settings-surface="true"] .border-\\[\\#2D2D2B\\]\\/20');
    expect(indexCss).toContain('border-color: var(--divider-subtle) !important;');
    expect(dataSettings).toContain('border border-[#2D2D2B] border-t-transparent animate-spin');
    expect(indexCss).toContain('[data-settings-surface="true"] .border-t-transparent');
    expect(indexCss).toContain('border-top-color: transparent !important;');
  });

  it('does not let body-level panel fallbacks shadow the hydrated divider token', async () => {
    const indexCss = await readFile(indexCssPath, 'utf8');

    expect(indexCss).toContain('--panel-divider: var(--divider-subtle, #E6E2DA);');
    expect(indexCss).toContain('--panel-divider: var(--divider-subtle, rgba(249,249,247,0.15));');
    expect(indexCss).not.toContain('--panel-divider: #E6E2DA;');
    expect(indexCss).not.toContain('--panel-divider: rgba(249,249,247,0.15);');
  });

  it('keeps strong borders independent from the shared translucent divider', async () => {
    const [source, indexCss] = await Promise.all([
      readFile(themeInjectorPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    expect(source).toContain("root.style.setProperty('--border-default', 'var(--divider-subtle)');");
    expect(source).toContain("root.style.setProperty('--border-strong', 'rgba(249,249,247,0.30)');");
    expect(source).toContain("root.style.setProperty('--border-strong', '#E6E2DA');");
    expect(source).not.toContain("root.style.setProperty('--border-strong', 'var(--divider-subtle)');");
    expect(source).not.toContain("root.style.setProperty('--border-primary', '#2D2D2B');");
    expect(source).toContain("root.style.setProperty('--control-shadow-ink', '#000000');");
    expect(source).toContain("root.style.setProperty('--control-shadow-ink', '#E6E2DA');");
    expect(source).toContain('color-mix(in srgb, var(--control-shadow-ink) 24%, transparent)');
    expect(source).not.toContain('color-mix(in srgb, var(--border-strong) 24%, transparent)');
    expect(indexCss).not.toContain('[data-theme="dark"] .shadow-\\[2px_2px_0_0_rgba\\(45\\,45\\,43\\,1\\)\\]');
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
    expect(rightPanel).toContain('relative flex items-center justify-center transition-colors');
    expect(rightPanel).toContain("inTitlebar ? 'h-[26px] w-9 shrink-0 cursor-pointer rounded' : 'flex-1 h-6 rounded-md'");
    // Titlebar tabs sit on the bare bar: a soft fill, no raised-pill shadow.
    expect(rightPanel).toContain("'rgba(45,45,43,0.07)'");
    expect(rightPanel).toContain(": '0 1px 2px rgba(45,45,43,0.1), 0 0 0 1px rgba(45,45,43,0.04)'");
  });

  it('uses the shared divider for linked-mention separators and cards', async () => {
    const previewPane = await readFile(previewPanePath, 'utf8');

    expect(previewPane).toContain("borderTop: '1px dashed var(--divider-subtle, #E6E2DA)'");
    expect(previewPane).toContain("border: '1px solid var(--divider-subtle, #E6E2DA)'");
  });

  it('uses a subtle baseline beneath the editor tab strip', async () => {
    const editorHeader = await readFile(editorHeaderPath, 'utf8');

    expect(editorHeader).toContain('after:bg-[var(--divider-subtle)]');
    expect(editorHeader).not.toContain("after:bg-[#2D2D2B]'}");
  });

  it('keeps the tab strip on the editor canvas instead of a separate tinted surface', async () => {
    const editorHeader = await readFile(editorHeaderPath, 'utf8');

    expect(editorHeader).toContain("isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'");
    expect(editorHeader).toContain('after:bg-[var(--divider-subtle)]');
  });

  it('starts the lifted tab-strip baseline after the visible desktop sidebar', async () => {
    const topBar = await readFile(topBarPath, 'utf8');

    expect(topBar).not.toContain('after:inset-x-0');
    expect(topBar).toContain('const isSidebarVisible = isSidebarOpen || isSidebarPreviewOpen');
    expect(topBar).toContain("!isMobile && isSidebarVisible ? 'after:left-[var(--noa-sidebar-width,325px)]' : 'after:left-0'");
    expect(topBar).toContain('after:absolute after:right-0 after:bottom-0 after:h-px');
    expect(topBar).toContain('after:bg-[var(--divider-subtle)]');
  });

  it('collapses export and version history into one overflow menu', async () => {
    const [editorHeader, editorActions] = await Promise.all([
      readFile(editorHeaderPath, 'utf8'),
      readFile(editorActionsPath, 'utf8'),
    ]);

    // The header renders them through its actions slot, not inline.
    expect(editorHeader).not.toContain('ExportMenu');
    expect(editorHeader).not.toContain('onToggleHistory');
    expect(editorHeader).not.toContain('setViewMode');

    expect(editorActions).toContain('<MoreHorizontal size={14} />');
    expect(editorActions).toContain('aria-haspopup="menu"');
    expect(editorActions).toContain('Version History');
    expect(editorActions).toContain('Export as Markdown');
    expect(editorActions).toContain('Export as HTML');
    expect(editorActions).toContain('Export as PDF');
  });

  it('cycles editor view modes through one next-mode icon', async () => {
    const [editorHeader, editorActions] = await Promise.all([
      readFile(editorHeaderPath, 'utf8'),
      readFile(editorActionsPath, 'utf8'),
    ]);

    expect(editorHeader).not.toContain('rounded-lg p-0.5 border');
    expect(editorHeader).not.toContain('shadow-[inset_0_1px_2px');
    expect(editorHeader).not.toContain('formatRelativeTime(note.updatedAt)');
    expect(editorHeader).toContain("const noDragRegion: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' };");
    expect(editorHeader).toContain('style={noDragRegion}');

    expect(editorActions).toContain("const nextViewMode = viewMode === 'edit' ? 'split' : viewMode === 'split' ? 'preview' : 'edit';");
    expect(editorActions).toContain('onClick={() => setViewMode(nextViewMode)}');
    expect(editorActions).toContain('aria-label={`Switch to ${nextViewModeLabel} view`}');
    expect(editorActions).toContain("const NextViewModeIcon = nextViewMode === 'edit' ? Edit2 : nextViewMode === 'split' ? Columns : Eye;");
    expect(editorActions).toContain('<NextViewModeIcon size={14} />');
    expect(editorActions).not.toContain('<ViewModeIcon size={14} />');
    expect(editorActions).not.toContain('aria-label="Edit only"');
    expect(editorActions).not.toContain('aria-label="Split view"');
    expect(editorActions).not.toContain('aria-label="Preview only"');
  });

  it('uses the shared divider for the compact title-bar search without an accent focus ring', async () => {
    const [topBar, indexCss] = await Promise.all([
      readFile(topBarPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    expect(topBar).toContain("'var(--divider-subtle, #E6E2DA)'");
    expect(topBar).toContain('noa-titlebar-search-input');
    expect(indexCss).not.toContain('input:focus-visible');
    expect(indexCss).not.toContain('textarea:focus-visible');
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

  it('balances the desktop title-bar icon group against the native traffic lights', async () => {
    const topBar = await readFile(topBarPath, 'utf8');

    expect(topBar).toContain("isMobile ? 'pl-2 pr-1' : 'pl-[82.5px] pr-4'");
  });

  it('animates the separator with direct toggles but keeps it fixed during preview promotion', async () => {
    const [topBar, app, indexCss] = await Promise.all([
      readFile(topBarPath, 'utf8'),
      readFile(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    expect(topBar).not.toContain('className="h-8 border-b grid');
    expect(topBar).not.toContain('className="pointer-events-none absolute bottom-0 right-0 h-px transition-[left]"');
    expect(app).toContain('className="flex-1 flex min-h-0 overflow-visible relative"');
    expect(app).toContain('data-sidebar-separator="true"');
    expect(app).toContain("${isPromotingSidebarPreview ? 'noa-sidebar-promotion-divider' : ''}");
    expect(app).toContain(": isSidebarOpen ? 'var(--noa-sidebar-width, 325px)' : '-1px'");
    expect(app).toContain('opacity: isSidebarOpen ? 1 : 0');
    expect(app).toMatch(/left: isPromotingSidebarPreview[\s\S]*?opacity: isSidebarOpen \? 1 : 0,[\s\S]*?transition: isPromotingSidebarPreview \|\| isDraggingSidebar/);
    expect(app).toContain('`left 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 0ms linear ${isSidebarOpen ? \'0ms\' : \'220ms\'}`');
    expect(indexCss).toContain('.noa-sidebar-promotion-divider {\n  left: var(--noa-sidebar-width, 325px);\n}');
    expect(indexCss).not.toContain('@keyframes noa-sidebar-promotion-divider-push');
    expect(app).not.toContain('opacity 80ms ease-out 140ms');
    expect(app).not.toContain("left: 'var(--noa-sidebar-width, 325px)'");
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

    expect(topBar).toContain('relative z-50 flex min-w-0 items-center gap-0.5');
    expect(editorHeader).toContain('reserveTitlebarTraffic?: boolean;');
    expect(editorHeader).toContain('reserveTitlebarTraffic = false,');
    expect(editorHeader).toContain("marginLeft: liftTabStrip && reserveTitlebarTraffic ? '9rem' : undefined");
    expect(editorHeader).toContain("marginRight: reserveTitlebarActions ? '7.25rem' : undefined");
    expect(editorHeader).toContain("transition: liftTabStrip ? 'margin 220ms cubic-bezier(0.4, 0, 0.2, 1)' : undefined");
    expect(editorHeader).not.toContain("paddingLeft: liftTabStrip && reserveTitlebarTraffic");
    expect(editorHeader).not.toContain("paddingRight: reserveTitlebarActions");
    expect(editor).toContain('reserveTitlebarTraffic?: boolean;');
    expect(editor).toContain('reserveTitlebarTraffic={reserveTitlebarTraffic}');
    expect(app).toContain('reserveTitlebarTraffic={!isMobile && !isFocusMode && !isSidebarOpen}');
  });

  it('slides fixed-width side panels instead of cropping them with width animation', async () => {
    const app = await readFile(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8');

    expect(app).toMatch(/marginLeft: !isMobile && !isPromotingSidebarPreview && \(isFocusMode \|\| !isSidebarOpen\)[\s\S]*?'calc\(-1 \* var\(--noa-sidebar-width, 325px\)\)'[\s\S]*?: '0px'/);
    expect(app).toMatch(/transition: isSidebarPreviewOpen[\s\S]*?isDraggingSidebar \|\| isPromotingSidebarPreview[\s\S]*?\? 'none'[\s\S]*?: \(isMobile \? 'transform 220ms cubic-bezier\(0\.4, 0, 0\.2, 1\)' : 'margin-left 220ms cubic-bezier\(0\.4, 0, 0\.2, 1\)'\)/);
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
    // The zoom pad dropped its frame for the shared accent wash
    // (.noa-graph-control-surface), so there is no longer a border to route
    // through the token. Guard the file instead: no raw hex border colour may
    // reappear in an inline style. Tailwind `border-[#…]` classes are NOT caught
    // here on purpose — those are class-name handles that ThemeInjector remaps
    // onto tokens, so they are the sanctioned form. Inline styles bypass that
    // remapping, which is exactly what this guards. var() fallbacks legitimately
    // carry a hex, so neutralize them before scanning.
    //
    // The value side must stay unanchored from the quote: `isDark ? '#A' : '#B'`
    // is the dominant inline-style shape in this file, so a pattern that only
    // matched a quote directly after the colon would miss the most likely way
    // for a hex to come back. Stopping at , ; } newline keeps it from bridging
    // into an unrelated property on the same line. Not covered: a hex reached
    // through an intermediate const (`borderColor: someVar`) — that needs data
    // flow, not a regex.
    const HEX_BORDER = /border(?:[A-Z]\w+|-\w+)*\s*[:=][^\n;},]*#[0-9a-fA-F]{3,8}/;

    // Guard the guard: these are the shapes it must keep catching if someone
    // rewrites the pattern later.
    for (const shape of [
      "border: '1px solid #E6E2DA'",
      'borderColor: isDark ? "#3A3A37" : "#E6E2DA"',
      'borderTop: `1px solid ${isDark ? "#333" : "#E6E2DA"}`',
      "borderBottomColor: '#E6E2DA'",
    ]) {
      expect(HEX_BORDER.test(shape)).toBe(true);
    }
    // …and these must stay clean, or the guard just becomes noise.
    for (const shape of [
      "border: '1px solid var(--token)'",
      "borderRadius: 4, background: '#CC7D5E'",
      'className="border rounded-md border-[#2D2D2B]"',
    ]) {
      expect(HEX_BORDER.test(shape)).toBe(false);
    }

    const graphViewSansVars = graphView.replace(/var\([^)]*\)/g, 'var(--token)');
    expect(graphView).toContain('noa-graph-control-surface');
    expect(graphViewSansVars).not.toMatch(HEX_BORDER);
  });

  it('uses soft elevation instead of hard offset outlines for floating surfaces', async () => {
    const [themeInjector, app, sidebar, tocPanel] = await Promise.all([
      readFile(themeInjectorPath, 'utf8'),
      readFile(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8'),
      readFile(sidebarPath, 'utf8'),
      readFile(tocPanelPath, 'utf8'),
    ]);

    expect(themeInjector).toContain('box-shadow: 0 4px 12px 0 color-mix(in srgb, var(--control-shadow-ink) 28%, transparent)');
    expect(themeInjector).not.toContain('box-shadow: 4px 4px 0 0 var(--border-strong)');
    for (const source of [app, sidebar, tocPanel]) {
      expect(source).not.toContain('shadow-[4px_4px_0px_0px');
    }
  });
});
