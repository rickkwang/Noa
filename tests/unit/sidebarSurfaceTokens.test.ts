import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const themeInjectorPath = fileURLToPath(new URL('../../src/components/ThemeInjector.tsx', import.meta.url));
const indexCssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));
const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));
const fileNodePath = fileURLToPath(new URL('../../src/components/sidebar/FileNode.tsx', import.meta.url));
const tagBrowserPath = fileURLToPath(new URL('../../src/components/sidebar/TagBrowser.tsx', import.meta.url));
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

    expect(injector).toContain("root.style.setProperty('--bg-sidebar', '#323230');");
    expect(injector).toContain("root.style.setProperty('--bg-sidebar', '#FBFBF9');");
    // Multi-layer falloff: a single 6px/14px shadow banded visibly on the dark canvas.
    expect(injector).toContain(
      "root.style.setProperty('--sidebar-preview-shadow', '0 0 0 1px rgba(0,0,0,0.07), 3px 0 6px -2px rgba(0,0,0,0.09), 10px 0 22px -6px rgba(0,0,0,0.11), 26px 0 54px -16px rgba(0,0,0,0.12)');",
    );
    expect(injector).toContain(
      "root.style.setProperty('--sidebar-preview-shadow', '0 0 0 1px rgba(45,45,43,0.03), 3px 0 6px -2px rgba(45,45,43,0.035), 10px 0 22px -6px rgba(45,45,43,0.04), 26px 0 54px -16px rgba(45,45,43,0.05)');",
    );
    // Light-only: the solid row highlight must move with the floor (dark uses translucent white).
    expect(injector).toContain("root.style.setProperty('--bg-sidebar-raised', '#EAE5DE');");
    // BrowserWindow backs the whole app, so it must match --bg-primary during startup and resize.
    expect(injector).toContain("isDark ? '#2D2D2B' : '#FCFCFB'");
    expect(electronMain).toContain("backgroundColor: '#FCFCFB'");
  });

  it('routes the sidebar surface through the token, never a literal', async () => {
    const [css, sidebar, topBar, app] = await Promise.all([
      readFile(indexCssPath, 'utf8'),
      readFile(sidebarPath, 'utf8'),
      readFile(topBarPath, 'utf8'),
      readFile(appPath, 'utf8'),
    ]);

    // Scoped to the rule block: a bare toContain would match the nested section-surface rule too.
    expect(css).toMatch(
      /\.noa-sidebar-surface\s*\{[^}]*background-color:\s*var\(--bg-sidebar,\s*#F4F4F2\)/,
    );
    expect(css).toMatch(
      /\[data-sidebar-preview="true"\]\s+\.noa-sidebar-surface,\s*\[data-sidebar-preview="true"\]\s+\.noa-sidebar-section-surface[^{]*\{[^}]*background-color:\s*transparent/,
    );

    // Preview matches the main canvas on purpose; a separate titlebar band would recreate the seam.
    expect(sidebar).toMatch(/className="noa-sidebar-surface\b/);
    expect(app).toContain('data-sidebar-column-surface="true"');
    expect(app).toContain('data-sidebar-preview-shell={isSidebarPreviewOpen');
    const previewSurface = app.slice(
      app.indexOf('data-sidebar-column-surface="true"'),
      app.indexOf('!isFocusMode && <TopBar'),
    );
    expect(previewSurface).toContain("backgroundColor: isSidebarPreviewOpen");
    expect(previewSurface).toContain("? 'var(--bg-primary, #FCFCFB)'");
    expect(previewSurface).toContain(": 'var(--bg-sidebar, #F4F4F2)'");
    expect(topBar).not.toContain('sidebar-titlebar-surface');
    expect(topBar).not.toContain('backgroundImage: `linear-gradient');
    expect(topBar).not.toMatch(/backgroundColor:\s*['"]#F4F4F2['"]/);
    expect(css).toMatch(
      /\.noa-sidebar-preview-shell\s*\{[^}]*box-shadow:\s*var\(--sidebar-preview-shadow,\s*0 0 0 1px rgba\(45,45,43,0\.03\)/,
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

  it('gives the calendar clear today, active-note, and keyboard interaction states', async () => {
    const calendar = await readFile(calendarPath, 'utf8');

    expect(calendar).toContain('const ariaLabel = [`Open ${dateStr}`, tip].filter(Boolean).join(\', \');');
    expect(calendar).toContain('aria-label={ariaLabel}');
    expect(calendar).toContain('type="button"');
    expect(calendar).toContain('w-8 h-8');
    expect(calendar).toContain('bg-[#CC7D5E]/12 text-[#CC7D5E] font-bold hover:bg-[#CC7D5E]/20');
    expect(calendar).toContain('bg-[#CC7D5E] text-white');
    expect(calendar).toContain('text-xs font-medium font-redaction');
    // Kept at /75 (not /60): at /60 the numerals matched the weekday header's weight and the grid read flat.
    expect(calendar).toContain("else cellClass += 'text-[#2D2D2B]/75';");
    expect(calendar).toContain('text-[#2D2D2B]/50');
  });

  it('keeps inactive tag filters in the muted warm hue system', async () => {
    const [css, tagBrowser] = await Promise.all([
      readFile(indexCssPath, 'utf8'),
      readFile(tagBrowserPath, 'utf8'),
    ]);

    expect(css).toContain('background: hsl(var(--tag-h) 18% 90%);');
    expect(css).toContain('background: hsl(var(--tag-h) 10% 19%);');
    expect(css).toContain('color: hsl(var(--tag-h) 16% 64%);');
    expect(css).toContain('border-color: var(--divider-subtle, rgba(249,249,247,0.15));');
    expect(tagBrowser).toContain("style={{ ['--tag-h' as string]: tagHue(tag.name) } as React.CSSProperties}");
    expect(tagBrowser).not.toContain('uppercase tracking-');
  });

  it('applies the optional translucent material only to the expanded desktop sidebar', async () => {
    const [injector, css, app, topBar, appearanceSettings, electronMain] = await Promise.all([
      readFile(themeInjectorPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
      readFile(appPath, 'utf8'),
      readFile(topBarPath, 'utf8'),
      readFile(appearanceSettingsPath, 'utf8'),
      readFile(electronMainPath, 'utf8'),
    ]);

    expect(injector).toContain("root.dataset.translucentSidebar = settings.appearance.translucentSidebar ? 'enabled' : 'disabled';");
    expect(injector).toMatch(
      /setSidebarTranslucency\(\s*settings\.appearance\.translucentSidebar,\s*isDark \? '#2D2D2B' : '#FCFCFB',\s*settings\.appearance\.theme/,
    );
    expect(injector).toContain("root.style.setProperty('--sidebar-material-tint', '70%');");
    expect(injector).toContain("root.style.setProperty('--sidebar-material-color', '#3B3B39');");
    expect(injector).toContain("root.style.setProperty('--sidebar-material-color', '#FAFAF8');");
    // Separator uses the shared divider token; no bespoke colour/shadow vars may return.
    expect(injector).not.toContain('--sidebar-divider-color');
    expect(injector).not.toContain('--sidebar-divider-shadow');
    expect(electronMain).toContain("const allowedThemeSources = new Set(['system', 'light', 'dark']);");
    expect(electronMain).toContain('nativeTheme.themeSource = themeSource;');
    expect(electronMain).toContain("setVibrancy(resolved.vibrancy, { animationDuration: 160 })");
    // Pinned 'active' so blur doesn't swap to the pale inactive material (reads as flashing).
    expect(electronMain).toContain("visualEffectState: 'active',");
    // Transparent windows drop the material after a Stage Manager switch; keep it opaque.
    expect(electronMain).not.toMatch(/new BrowserWindow\(\{[^}]*transparent:/);
    expect(app).toContain("data-sidebar-expanded={isSidebarMaterialActive ? 'true' : undefined}");
    expect(app).toContain('className={`pointer-events-none absolute top-0 bottom-0 z-30 ${isPromotingSidebarPreview');
    expect(app).toContain("'--noa-sidebar-material-width': isSidebarOpen");
    expect(app).toContain("backgroundColor: 'var(--divider-subtle, #E6E2DA)'");
    expect(css).toMatch(
      /@property --noa-sidebar-material-width\s*\{[^}]*syntax:\s*['"]<length>['"][^}]*inherits:\s*true[^}]*initial-value:\s*0px/,
    );
    // Inherited registered property must never transition: it would re-style the whole app every frame.
    expect(app).toContain("transition: 'none',");
    expect(css).not.toMatch(/transition:[^;]*--noa-sidebar-material-width/);
    expect(app).not.toMatch(/transition:[^,]*--noa-sidebar-material-width/);
    expect(app).toContain("data-sidebar-dock-motion={isSidebarDockMotionLive ? 'true' : undefined}");
    expect(app).not.toContain('data-sidebar-dragging');
    // Translucency is gated on :where(:not([data-settings-open])) so the settings scrim doesn't halo the text.
    expect(css).toMatch(
      /html\[data-translucent-sidebar="enabled"\]:where\(:not\(\[data-settings-open="true"\]\)\)\s+\[data-sidebar-expanded="true"\]\[data-sidebar-column-surface="true"\]\s*\{[^}]*background-color:\s*color-mix\(in srgb, var\(--sidebar-material-color, #FAFAF8\) var\(--sidebar-material-tint, 70%\), transparent\)/,
    );
    expect(css).not.toContain('[data-sidebar-separator="true"] {');
    expect(css).not.toContain('.noa-app-shell:has([data-sidebar-container][data-sidebar-expanded="true"])::after');
    // Electron provides the native material; a CSS backdrop-filter here would halo the edge.
    expect(css).not.toMatch(
      /\[data-sidebar-expanded="true"\]\[data-sidebar-column-surface="true"\]\s*\{[^}]*backdrop-filter:/,
    );
    // The opaque plane is a single ::before veil on the shell, slid by transform.
    expect(css).toMatch(
      /\.noa-app-shell:has\(\[data-sidebar-expanded="true"\]\)\s*\{[^}]*background:\s*transparent\s*!important;[^}]*isolation:\s*isolate/,
    );
    expect(css).toMatch(
      /\.noa-app-shell:has\(\[data-sidebar-expanded="true"\]\)::before\s*\{[^}]*z-index:\s*-1;[^}]*background-color:\s*var\(--bg-primary, #FCFCFB\);[^}]*transform:\s*translateX\(var\(--noa-sidebar-material-width\)\);[^}]*transition:\s*none;/,
    );
    // Start value is needed so the veil animates from it on open (not a computed-style check).
    expect(css).toMatch(
      /@starting-style \{\s*transform: translateX\(0\);/,
    );
    // Arming rule: the veil transitions only for the dock motion, after first paint. Otherwise
    // @starting-style fires on promotion (a first render) and sweeps an opaque plane across the editor.
    expect(css).toMatch(
      /html\[data-translucent-sidebar="enabled"\]:where\(:not\(\[data-settings-open="true"\]\)\) \.noa-app-shell\[data-sidebar-dock-motion="true"\]\[data-sidebar-material-painted="true"\]:has\(\[data-sidebar-expanded="true"\]\)::before\s*\{\s*transition:\s*transform 500ms/,
    );
    // Titlebar is transparent so the shell veil shows through; its own ::before would re-rasterize icon strokes.
    expect(css).toMatch(
      /\[data-translucent-sidebar-titlebar="true"\]\s*\{[^}]*background:\s*transparent\s*!important/,
    );
    expect(css).not.toMatch(/\[data-translucent-sidebar-titlebar="true"\]::before/);
    // Drag must not get a transition: it would lag the cursor. It stays excluded by the arming flag, not default-on.
    expect(css).not.toMatch(
      /\.noa-app-shell\[data-sidebar-dragging="true"\]::before/,
    );
    expect(css).not.toMatch(
      /\.noa-app-shell:not\(\[data-sidebar-material-painted="true"\]\)/,
    );
    // Reduced motion must reach the veil itself, since the host no longer animates.
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,400}\.noa-app-shell::before\s*\{\s*transition:\s*none !important/,
    );
    expect(css).toMatch(
      /html\[data-translucent-sidebar="enabled"\]:where\(:not\(\[data-settings-open="true"\]\)\)\s+body\s*\{[^}]*background-color:\s*transparent/,
    );
    expect(css).not.toMatch(
      /html\[data-translucent-sidebar="enabled"\][^{]*\[data-sidebar-preview-shell="true"\][^{]*\{/,
    );
    expect(appearanceSettings).toContain('label="Translucent Sidebar"');
    expect(appearanceSettings).toContain('checked={settings.appearance.translucentSidebar}');
    expect(appearanceSettings).toContain('translucentSidebar: checked');
  });
});
