import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const themeInjectorPath = fileURLToPath(new URL('../../src/components/ThemeInjector.tsx', import.meta.url));
const indexCssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));
const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));
const fileNodePath = fileURLToPath(new URL('../../src/components/sidebar/FileNode.tsx', import.meta.url));
const calendarPath = fileURLToPath(new URL('../../src/components/CalendarPanel.tsx', import.meta.url));
const topBarPath = fileURLToPath(new URL('../../src/components/TopBar.tsx', import.meta.url));
const appPath = fileURLToPath(new URL('../../src/App.tsx', import.meta.url));
const electronMainPath = fileURLToPath(new URL('../../electron/main.cjs', import.meta.url));
const appearanceSettingsPath = fileURLToPath(new URL('../../src/components/settings/sections/AppearanceSettings.tsx', import.meta.url));

describe('sidebar surface tokens', () => {
  it('defines the sidebar floor for both themes', async () => {
    const [injector, electronMain] = await Promise.all([
      readFile(themeInjectorPath, 'utf8'),
      readFile(electronMainPath, 'utf8'),
    ]);

    expect(injector).toContain("root.style.setProperty('--bg-sidebar', '#2A2A28');");
    expect(injector).toContain("root.style.setProperty('--bg-sidebar', '#F4F4F2');");
    expect(injector).toContain("root.style.setProperty('--sidebar-preview-shadow', '6px 0 14px rgba(18,18,16,0.14)');");
    expect(injector).toContain("root.style.setProperty('--sidebar-preview-shadow', '6px 0 14px rgba(45,45,43,0.07)');");
    // Both floors must keep the editor plane's own red-blue spread of 2. A
    // wider spread reads as the sidebar changing colour instead of depth,
    // which is what the first attempt at this got wrong.
    for (const [floor, plane] of [['#2A2A28', '#2D2D2B'], ['#F4F4F2', '#F9F9F7']]) {
      const spread = (hex: string) => parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(5, 7), 16);
      expect(spread(floor)).toBe(spread(plane));
    }
    // Light mode alone needs the paired highlight token: its row highlight is a
    // solid colour, so it has to move down with the floor. Dark mode highlights
    // with translucent white and re-adapts on its own.
    expect(injector).toContain("root.style.setProperty('--bg-sidebar-raised', '#EAE5DE');");
    // The preview itself uses --bg-primary, but BrowserWindow is the backing
    // plane for the whole app and must continue matching --bg-primary during
    // startup and live resize.
    expect(injector).toContain("isDark ? '#2D2D2B' : '#F9F9F7'");
    expect(electronMain).toContain("backgroundColor: '#F9F9F7'");
  });

  it('routes the sidebar surface through the token, never a literal', async () => {
    const [css, sidebar, topBar, app] = await Promise.all([
      readFile(indexCssPath, 'utf8'),
      readFile(sidebarPath, 'utf8'),
      readFile(topBarPath, 'utf8'),
      readFile(appPath, 'utf8'),
    ]);

    // Scoped to the rule block, not the file. A bare toContain passes on any
    // other rule that happens to use the same declaration (the nested
    // section-surface rule does), so it would not notice this one being
    // rewritten to a literal. `\s*\{` pins it to the bare class selector.
    expect(css).toMatch(
      /\.noa-sidebar-surface\s*\{[^}]*background-color:\s*var\(--bg-sidebar,\s*#F4F4F2\)/,
    );
    expect(css).toMatch(
      /\[data-sidebar-preview="true"\]\s+\.noa-sidebar-surface,\s*\[data-sidebar-preview="true"\]\s+\.noa-sidebar-section-surface\s*\{[^}]*background-color:\s*transparent/,
    );

    // Preview is one full-height floating surface rooted in the app shell and
    // deliberately matches the main canvas. The expanded sidebar keeps its
    // own floor, while painting a separate titlebar band would recreate the
    // visible seam.
    expect(sidebar).toMatch(/className="noa-sidebar-surface\b/);
    expect(app).toContain('data-sidebar-column-surface="true"');
    expect(app).toContain('data-sidebar-preview-shell={isSidebarPreviewOpen');
    const previewSurface = app.slice(
      app.indexOf('data-sidebar-column-surface="true"'),
      app.indexOf('!isFocusMode && <TopBar'),
    );
    expect(previewSurface).toContain("backgroundColor: isSidebarPreviewOpen");
    expect(previewSurface).toContain("? 'var(--bg-primary, #F9F9F7)'");
    expect(previewSurface).toContain(": 'var(--bg-sidebar, #F4F4F2)'");
    expect(topBar).not.toContain('sidebar-titlebar-surface');
    expect(topBar).not.toContain('backgroundImage: `linear-gradient');
    expect(topBar).not.toMatch(/backgroundColor:\s*['"]#F4F4F2['"]/);
    expect(css).toMatch(
      /\.noa-sidebar-preview-shell\s*\{[^}]*box-shadow:\s*var\(--sidebar-preview-shadow,\s*6px 0 14px rgb\(45 45 43 \/ 7%\)\)/,
    );
    expect(css).toContain('opacity 180ms cubic-bezier(0.22, 1, 0.36, 1)');
    expect(css).toContain('@starting-style');
    expect(css).toContain('translateX(-4px)');
    expect(app).toContain("data-sidebar-preview-closing={isSidebarPreviewClosing ? 'true' : undefined}");
    expect(app).toContain('onTransitionEnd={finishSidebarPreviewExit}');
    expect(app).toContain('onTransitionEnd={finishSidebarPromotion}');
    expect(app).not.toContain('SIDEBAR_PREVIEW_EXIT_MS');
    expect(app).not.toContain('SIDEBAR_PROMOTION_MS');
    expect(app).not.toContain('sidebarPreviewExitTimerRef');
  });

  it('routes sidebar interaction states through semantic classes', async () => {
    const [css, sidebar, fileNode, calendar] = await Promise.all([
      readFile(indexCssPath, 'utf8'),
      readFile(sidebarPath, 'utf8'),
      readFile(fileNodePath, 'utf8'),
      readFile(calendarPath, 'utf8'),
    ]);

    expect(css).toMatch(/\.noa-sidebar-active-surface\s*\{[^}]*var\(--bg-sidebar-raised,\s*#EAE5DE\)/);
    expect(css).toMatch(/\.noa-sidebar-hover-surface:hover\s*\{[^}]*var\(--bg-sidebar-raised,\s*#EAE5DE\)/);
    expect(css).toMatch(/\.noa-sidebar-hover-surface-subtle:hover\s*\{[^}]*var\(--bg-sidebar-raised,\s*#EAE5DE\)/);
    expect(css).not.toContain('.noa-sidebar-surface .bg-\\[\\#EFEAE3\\]');
    expect(css).not.toContain('.noa-sidebar-surface .hover\\:bg-\\[\\#EFEAE3\\]');

    expect(fileNode).toContain("isActive ? 'noa-sidebar-active-surface' : 'noa-sidebar-hover-surface-subtle'");
    expect(sidebar).toContain('noa-sidebar-hover-surface');
    expect(sidebar).toContain('noa-sidebar-hover-surface-subtle');
    expect(calendar).toContain('noa-sidebar-hover-surface');
    for (const consumer of [sidebar, fileNode, calendar]) {
      expect(consumer).not.toMatch(/(?:hover:)?bg-\[#EFEAE3\](?:\/50)?/);
    }

    const darkActive = css.match(
      /\[data-theme="dark"\] \.noa-sidebar-active-surface\s*\{[^}]*rgba\(249,\s*249,\s*247,\s*([\d.]+)\)/,
    );
    const darkHover = css.match(
      /\[data-theme="dark"\] \.noa-sidebar-hover-surface:hover\s*\{[^}]*rgba\(249,\s*249,\s*247,\s*([\d.]+)\)/,
    );
    expect(darkActive).not.toBeNull();
    expect(darkHover).not.toBeNull();
    expect(Number(darkActive![1])).toBeGreaterThan(Number(darkHover![1]));
  });

  it('applies the optional translucent material only to the expanded desktop sidebar', async () => {
    const [injector, css, app, appearanceSettings, electronMain] = await Promise.all([
      readFile(themeInjectorPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
      readFile(appPath, 'utf8'),
      readFile(appearanceSettingsPath, 'utf8'),
      readFile(electronMainPath, 'utf8'),
    ]);

    expect(injector).toContain("root.dataset.translucentSidebar = settings.appearance.translucentSidebar ? 'enabled' : 'disabled';");
    expect(injector).toMatch(
      /setSidebarTranslucency\(\s*settings\.appearance\.translucentSidebar,\s*isDark \? '#2D2D2B' : '#F9F9F7',\s*settings\.appearance\.theme/,
    );
    expect(injector).toContain("root.style.setProperty('--sidebar-material-tint', '54%');");
    expect(injector).toContain("root.style.setProperty('--sidebar-material-tint', '44%');");
    // The app-shell separator is a plain hairline on the shared divider token,
    // with no weight step and no shadow of its own: both the bespoke
    // --sidebar-divider-color and --sidebar-divider-shadow are gone, so it can
    // no longer drift away from every other divider on screen.
    expect(injector).not.toContain('--sidebar-divider-color');
    expect(injector).not.toContain('--sidebar-divider-shadow');
    expect(electronMain).toContain("const allowedThemeSources = new Set(['system', 'light', 'dark']);");
    expect(electronMain).toContain('nativeTheme.themeSource = themeSource;');
    expect(electronMain).toContain("setVibrancy(resolved.vibrancy, { animationDuration: 160 })");
    // Native vibrancy later clears the window backing. The BrowserWindow must
    // opt into alpha compositing at construction time; switching an opaque
    // window to #00000000 at runtime leaves stale surfaces visible when a GPU
    // canvas (the graph) joins the compositor tree.
    expect(electronMain).toMatch(/new BrowserWindow\(\{[\s\S]*transparent:\s*isMac,/);
    expect(app).toContain("data-sidebar-expanded={isSidebarMaterialActive ? 'true' : undefined}");
    expect(app).toContain('className={`pointer-events-none absolute top-0 bottom-0 z-30 ${isPromotingSidebarPreview');
    expect(app).toContain("'--noa-sidebar-material-width': isSidebarOpen");
    expect(app).toContain("backgroundColor: 'var(--divider-subtle, #E6E2DA)'");
    expect(css).toMatch(
      /@property --noa-sidebar-material-width\s*\{[^}]*syntax:\s*['"]<length>['"][^}]*inherits:\s*true[^}]*initial-value:\s*0px/,
    );
    expect(css).toMatch(
      /html\[data-translucent-sidebar="enabled"\]\s+\[data-sidebar-expanded="true"\]\[data-sidebar-column-surface="true"\]\s*\{[^}]*background-color:\s*color-mix\(in srgb, var\(--bg-sidebar, #F4F4F2\) var\(--sidebar-material-tint, 44%\), transparent\)/,
    );
    expect(css).not.toContain('[data-sidebar-separator="true"] {');
    expect(css).not.toContain('.noa-app-shell:has([data-sidebar-container][data-sidebar-expanded="true"])::after');
    // Electron supplies the native macOS sidebar material. A CSS backdrop blur
    // on this boundary samples the white editor plane outside the sidebar and
    // paints it back inside as a wide, bright edge halo.
    expect(css).not.toMatch(
      /\[data-sidebar-expanded="true"\]\[data-sidebar-column-surface="true"\]\s*\{[^}]*backdrop-filter:/,
    );
    expect(css).toMatch(
      /html\[data-translucent-sidebar="enabled"\]\s+\.noa-app-shell:has\(\[data-sidebar-expanded="true"\]\)\s*\{[^}]*linear-gradient\([^}]*transparent 0 var\(--noa-sidebar-material-width\)/,
    );
    expect(css).toMatch(
      /html\[data-translucent-sidebar="enabled"\]\s+\[data-translucent-sidebar-titlebar="true"\]\s*\{[^}]*linear-gradient\([^}]*transparent 0 var\(--noa-sidebar-material-width\)/,
    );
    expect(css).toMatch(
      /html\[data-translucent-sidebar="enabled"\]\s+body\s*\{[^}]*background-color:\s*transparent/,
    );
    expect(css).not.toMatch(
      /html\[data-translucent-sidebar="enabled"\][^{]*\[data-sidebar-preview-shell="true"\][^{]*\{/,
    );
    expect(appearanceSettings).toContain('label="Translucent sidebar"');
    expect(appearanceSettings).toContain('checked={settings.appearance.translucentSidebar}');
    expect(appearanceSettings).toContain('translucentSidebar: checked');
  });
});
