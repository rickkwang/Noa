import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getResponsivePanelMaxWidth,
  PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../../src/hooks/useLayout';

const useLayoutPath = fileURLToPath(new URL('../../src/hooks/useLayout.ts', import.meta.url));
const appPath = fileURLToPath(new URL('../../src/App.tsx', import.meta.url));
const topBarPath = fileURLToPath(new URL('../../src/components/TopBar.tsx', import.meta.url));

// Both sides are derived from source, never pinned to a literal here. Writing
// the number into this file would just create a fourth place to forget.
function readSidebarDefault(useLayout: string): number {
  const match = useLayout.match(/const SIDEBAR_DEFAULT_WIDTH\s*=\s*(\d+)/);
  if (!match) throw new Error('could not locate SIDEBAR_DEFAULT_WIDTH');
  return Number(match[1]);
}

function readSidebarClamp(useLayout: string): { min: number; max: number } {
  const match = useLayout.match(/useResizeDrag\(\s*SIDEBAR_DEFAULT_WIDTH\s*,\s*(SIDEBAR_MIN_WIDTH|\d+)\s*,\s*(PANEL_MAX_WIDTH|\d+)\s*,\s*getSidebarValue/);
  if (!match) throw new Error('could not locate the sidebar useResizeDrag call');
  return {
    min: match[1] === 'SIDEBAR_MIN_WIDTH' ? readSidebarDefault(useLayout) : Number(match[1]),
    max: match[2] === 'PANEL_MAX_WIDTH' ? PANEL_MAX_WIDTH : Number(match[2]),
  };
}

function collectFallbacks(source: string, variable: string): number[] {
  // Matches both spellings in the tree: `var(--x, 325px)` in inline styles and
  // `var(--x,325px)` inside Tailwind arbitrary values, which cannot take spaces.
  const pattern = new RegExp(`var\\(${variable},\\s*(\\d+)px\\)`, 'g');
  return [...source.matchAll(pattern)].map((m) => Number(m[1]));
}

describe('sidebar width fallbacks', () => {
  it('keeps every CSS fallback equal to the hook default', async () => {
    const [useLayout, app, topBar] = await Promise.all([
      readFile(useLayoutPath, 'utf8'),
      readFile(appPath, 'utf8'),
      readFile(topBarPath, 'utf8'),
    ]);

    const expected = readSidebarDefault(useLayout);
    const fallbacks = [
      ...collectFallbacks(app, '--noa-sidebar-width'),
      ...collectFallbacks(topBar, '--noa-sidebar-width'),
    ];

    // The fallback only paints on the first frame, before useLayout's effect
    // writes the real value onto the root element. A stale one is therefore
    // invisible in tests and shows up in the product as a one-frame jump on
    // every cold start, which is exactly the kind of drift nothing else here
    // was catching.
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const value of fallbacks) {
      expect(value).toBe(expected);
    }
  });

  it('keeps the right panel fallbacks equal to their own default', async () => {
    const [useLayout, app, topBar] = await Promise.all([
      readFile(useLayoutPath, 'utf8'),
      readFile(appPath, 'utf8'),
      readFile(topBarPath, 'utf8'),
    ]);

    const match = useLayout.match(/const RIGHT_PANEL_DEFAULT_WIDTH\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const expected = Number(match![1]);
    expect(useLayout).toMatch(/useResizeDrag\(\s*RIGHT_PANEL_DEFAULT_WIDTH,\s*RIGHT_PANEL_MIN_WIDTH,\s*PANEL_MAX_WIDTH,\s*getRightPanelValue/);
    // The drag minimum is the default itself, not a lower number the panel can
    // never climb back to.
    expect(RIGHT_PANEL_MIN_WIDTH).toBe(expected);

    const fallbacks = [
      ...collectFallbacks(app, '--noa-right-panel-width'),
      ...collectFallbacks(topBar, '--noa-right-panel-width'),
    ];

    expect(fallbacks.length).toBeGreaterThan(0);
    for (const value of fallbacks) {
      expect(value).toBe(expected);
    }
  });

  it('opens the right panel at the width it declares, on any desktop width', async () => {
    const useLayout = await readFile(useLayoutPath, 'utf8');
    const match = useLayout.match(/const RIGHT_PANEL_DEFAULT_WIDTH\s*=\s*(\d+)/);
    const expected = Number(match![1]);

    // Same guarantee the sidebar already had. Floored at its own default, the
    // responsive cap can never come in under it, so the panel opens at the
    // width the CSS fallbacks and the drag range all agree on — 971px is where
    // the 35% viewport cap crosses 340px, and below it the unfloored version
    // used to open narrow and jump on the first drag.
    expect(getResponsivePanelMaxWidth(900, expected)).toBe(expected);
    expect(getResponsivePanelMaxWidth(971, expected)).toBe(expected);
    expect(getResponsivePanelMaxWidth(1600, expected)).toBe(480);
    expect(useLayout.match(/getResponsivePanelMaxWidth\(window\.innerWidth, RIGHT_PANEL_DEFAULT_WIDTH\)/g))
      .toHaveLength(2);
  });

  it('reports the real drag bounds on both resize handles', async () => {
    const app = await readFile(appPath, 'utf8');

    // These were literals, and both had gone stale against the widths they
    // claimed to describe. A screen reader announces this range, so a wrong
    // number here is wrong in the only place the range is ever spoken.
    expect(app).toContain('aria-valuemin={SIDEBAR_MIN_WIDTH}');
    expect(app).toContain('aria-valuemin={RIGHT_PANEL_MIN_WIDTH}');
    expect(app.match(/aria-valuemax=\{PANEL_MAX_WIDTH\}/g)).toHaveLength(2);
    expect(app).not.toMatch(/aria-value(min|max)=\{\d+\}/);
    expect(SIDEBAR_MIN_WIDTH).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
    expect(RIGHT_PANEL_MIN_WIDTH).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
  });

  it('starts the sidebar inside its own drag range', async () => {
    const useLayout = await readFile(useLayoutPath, 'utf8');
    const initial = readSidebarDefault(useLayout);
    const { min, max } = readSidebarClamp(useLayout);

    // A default below the min would be silently clamped up on the first drag,
    // making the app jump the moment the user grabs the handle.
    expect(initial).toBeGreaterThanOrEqual(min);
    expect(initial).toBeLessThanOrEqual(max);
  });

  it('keeps the responsive sidebar maximum at or above its default', async () => {
    const useLayout = await readFile(useLayoutPath, 'utf8');
    const initial = readSidebarDefault(useLayout);

    // Both pointer and keyboard paths must share a viewport cap whose floor is
    // the default width. Otherwise a narrow desktop (for example 800px wide,
    // where 35% of the viewport lands under the default) opens narrower than
    // the default and jumps down on the first resize interaction.
    expect(getResponsivePanelMaxWidth(800, initial)).toBe(initial);
    expect(getResponsivePanelMaxWidth(885, initial)).toBe(initial);
    expect(getResponsivePanelMaxWidth(1600, initial)).toBe(480);
    expect(useLayout).toContain(
      'getResponsivePanelMaxWidth(window.innerWidth, SIDEBAR_DEFAULT_WIDTH)',
    );
    expect(useLayout.match(/getResponsivePanelMaxWidth\(window\.innerWidth, SIDEBAR_DEFAULT_WIDTH\)/g))
      .toHaveLength(2);
  });
});
