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
    // Multi-layer falloff, not a single mid-blur cast: one blurless contact
    // line plus three negative-spread layers. The old single 6px/14px shadow
    // banded visibly against the dark canvas.
    expect(injector).toContain(
      "root.style.setProperty('--sidebar-preview-shadow', '0 0 0 1px rgba(0,0,0,0.07), 3px 0 6px -2px rgba(0,0,0,0.09), 10px 0 22px -6px rgba(0,0,0,0.11), 26px 0 54px -16px rgba(0,0,0,0.12)');",
    );
    expect(injector).toContain(
      "root.style.setProperty('--sidebar-preview-shadow', '0 0 0 1px rgba(45,45,43,0.03), 3px 0 6px -2px rgba(45,45,43,0.035), 10px 0 22px -6px rgba(45,45,43,0.04), 26px 0 54px -16px rgba(45,45,43,0.05)');",
    );
    // Light mode alone needs the paired highlight token: its row highlight is a
    // solid colour, so it has to move down with the floor. Dark mode highlights
    // with translucent white and re-adapts on its own.
    expect(injector).toContain("root.style.setProperty('--bg-sidebar-raised', '#EAE5DE');");
    // The preview itself uses --bg-primary, but BrowserWindow is the backing
    // plane for the whole app and must continue matching --bg-primary during
    // startup and live resize.
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

    // Scoped to the rule block, not the file. A bare toContain passes on any
    // other rule that happens to use the same declaration (the nested
    // section-surface rule does), so it would not notice this one being
    // rewritten to a literal. `\s*\{` pins it to the bare class selector.
    expect(css).toMatch(
      /\.noa-sidebar-surface\s*\{[^}]*background-color:\s*var\(--bg-sidebar,\s*#F4F4F2\)/,
    );
    expect(css).toMatch(
      /\[data-sidebar-preview="true"\]\s+\.noa-sidebar-surface,\s*\[data-sidebar-preview="true"\]\s+\.noa-sidebar-section-surface[^{]*\{[^}]*background-color:\s*transparent/,
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
    // Raised from /60 deliberately: the weekday header sits at /50, and at /60
    // the numerals carried nearly the same weight, so the grid read as one flat
    // block instead of dates above a label row. Pinned so the step does not
    // quietly collapse again.
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
    expect(tagBrowser).toContain('tracking-[0.08em]');
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
    // Inheriting is only affordable because nothing transitions the property.
    // An animated inherited registered property re-invalidates the whole app
    // subtree every frame; the veils animate transform from it instead.
    expect(app).toContain("transition: 'none',");
    expect(css).not.toMatch(/transition:[^;]*--noa-sidebar-material-width/);
    expect(app).not.toMatch(/transition:[^,]*--noa-sidebar-material-width/);
    // The drag used to carry its own attribute here purely so the veil could opt
    // out of transitioning. It is one of the states the arming flag excludes now,
    // and nothing else ever read it.
    expect(app).toContain("data-sidebar-dock-motion={isSidebarDockMotionLive ? 'true' : undefined}");
    expect(app).not.toContain('data-sidebar-dragging');
    // Every translucency rule is gated on :where(:not([data-settings-open])),
    // which switches without contributing specificity.
    // The settings scrim blurs the frame behind it in premultiplied alpha, and
    // translucency leaves that frame transparent over the sidebar, which haloes
    // the text there. Switching the rules off lets each surface fall back to
    // the opaque floor it already carries — nothing is restated, so a
    // transparent surface added later cannot forget to opt in.
    expect(css).toMatch(
      /html\[data-translucent-sidebar="enabled"\]:where\(:not\(\[data-settings-open="true"\]\)\)\s+\[data-sidebar-expanded="true"\]\[data-sidebar-column-surface="true"\]\s*\{[^}]*background-color:\s*color-mix\(in srgb, var\(--bg-sidebar, #F4F4F2\) var\(--sidebar-material-tint, 44%\), transparent\)/,
    );
    expect(css).not.toContain('[data-sidebar-separator="true"] {');
    expect(css).not.toContain('.noa-app-shell:has([data-sidebar-container][data-sidebar-expanded="true"])::after');
    // Electron supplies the native macOS sidebar material. A CSS backdrop blur
    // on this boundary samples the white editor plane outside the sidebar and
    // paints it back inside as a wide, bright edge halo.
    expect(css).not.toMatch(
      /\[data-sidebar-expanded="true"\]\[data-sidebar-column-surface="true"\]\s*\{[^}]*backdrop-filter:/,
    );
    // The opaque plane is one ::before veil on the shell, slid by transform.
    expect(css).toMatch(
      /\.noa-app-shell:has\(\[data-sidebar-expanded="true"\]\)\s*\{[^}]*background:\s*transparent\s*!important;[^}]*isolation:\s*isolate/,
    );
    expect(css).toMatch(
      /\.noa-app-shell:has\(\[data-sidebar-expanded="true"\]\)::before\s*\{[^}]*z-index:\s*-1;[^}]*background-color:\s*var\(--bg-primary, #FCFCFB\);[^}]*transform:\s*translateX\(var\(--noa-sidebar-material-width\)\);[^}]*transition:\s*none;/,
    );
    // Dropping the start value costs one frame of translucent titlebar on open,
    // which no computed-style assertion can see after the fact.
    expect(css).toMatch(
      /@starting-style \{\s*transform: translateX\(0\);/,
    );
    // And the arming rule that gives that start value something to interpolate
    // from — only for the dock motion, and only once the shell has painted. The
    // veil rides the sidebar's own edge; every other way that edge moves puts it
    // somewhere in one frame, and a 320ms sweep over a column that is already
    // full reads as an opaque plane crossing the editor. Promoting the hover
    // preview is exactly that case, and it is also a first render, so
    // @starting-style fires on it.
    expect(css).toMatch(
      /html\[data-translucent-sidebar="enabled"\]:where\(:not\(\[data-settings-open="true"\]\)\) \.noa-app-shell\[data-sidebar-dock-motion="true"\]\[data-sidebar-material-painted="true"\]:has\(\[data-sidebar-expanded="true"\]\)::before\s*\{\s*transition:\s*transform 320ms/,
    );
    // The titlebar only goes transparent so that veil shows through. Giving it
    // a veil — and so a stacking context — of its own re-rasterized the
    // half-alpha icon strokes over the vibrant region; verified pixel-identical
    // to the old gradient only once it was removed.
    expect(css).toMatch(
      /\[data-translucent-sidebar-titlebar="true"\]\s*\{[^}]*background:\s*transparent\s*!important/,
    );
    expect(css).not.toMatch(/\[data-translucent-sidebar-titlebar="true"\]::before/);
    // A pointer drag already delivers one width per frame; a transition on top
    // of that only lags behind the cursor. It needs no rule of its own now —
    // the drag is one of the states the arming flag above excludes — but it
    // must not come back as a default with exclusions hung off it.
    expect(css).not.toMatch(
      /\.noa-app-shell\[data-sidebar-dragging="true"\]::before/,
    );
    expect(css).not.toMatch(
      /\.noa-app-shell:not\(\[data-sidebar-material-painted="true"\]\)/,
    );
    // Reduced motion must reach the veil, not just its host — the host no
    // longer carries the animation.
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
