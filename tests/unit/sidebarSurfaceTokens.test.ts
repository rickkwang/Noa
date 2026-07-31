import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const themeInjectorPath = fileURLToPath(new URL('../../src/components/ThemeInjector.tsx', import.meta.url));
const indexCssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));
const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));
const fileNodePath = fileURLToPath(new URL('../../src/components/sidebar/FileNode.tsx', import.meta.url));
const calendarPath = fileURLToPath(new URL('../../src/components/CalendarPanel.tsx', import.meta.url));
const topBarPath = fileURLToPath(new URL('../../src/components/TopBar.tsx', import.meta.url));

describe('sidebar surface tokens', () => {
  it('defines the sidebar floor for both themes', async () => {
    const injector = await readFile(themeInjectorPath, 'utf8');

    expect(injector).toContain("root.style.setProperty('--bg-sidebar', '#2A2A28');");
    expect(injector).toContain("root.style.setProperty('--bg-sidebar', '#F4F4F2');");
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
  });

  it('routes the sidebar surface through the token, never a literal', async () => {
    const [css, sidebar, topBar] = await Promise.all([
      readFile(indexCssPath, 'utf8'),
      readFile(sidebarPath, 'utf8'),
      readFile(topBarPath, 'utf8'),
    ]);

    // Scoped to the rule block, not the file. A bare toContain passes on any
    // other rule that happens to use the same declaration (the nested
    // section-surface rule does), so it would not notice this one being
    // rewritten to a literal. `\s*\{` pins it to the bare class selector.
    expect(css).toMatch(
      /\.noa-sidebar-surface\s*\{[^}]*background-color:\s*var\(--bg-sidebar,\s*#F4F4F2\)/,
    );

    // The sidebar root and the titlebar band that continues it must both carry
    // the class/token rather than restating a hex, or the two halves of the
    // same column can drift apart on a future palette change.
    expect(sidebar).toMatch(/className="noa-sidebar-surface\b/);
    expect(topBar).toContain("backgroundColor: 'var(--bg-sidebar, #F4F4F2)'");
    expect(topBar).not.toMatch(/backgroundColor:\s*['"]#F4F4F2['"]/);
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
});
