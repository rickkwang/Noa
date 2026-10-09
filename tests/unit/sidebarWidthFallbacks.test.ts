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
  // Matches `var(--x, 325px)` inline and `var(--x,325px)` in Tailwind arbitrary values (no spaces).
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

    // A stale fallback paints only before useLayout's effect runs, so it shows as a cold-start jump.
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
    // Drag minimum equals the default; a lower minimum would be unreachable on the way back up.
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

    // Floored at its own default so the panel never opens narrower than the fallbacks and drag range.
    expect(getResponsivePanelMaxWidth(900, expected)).toBe(expected);
    expect(getResponsivePanelMaxWidth(971, expected)).toBe(expected);
    expect(getResponsivePanelMaxWidth(1600, expected)).toBe(480);
    // The clamp and the drag.
    expect(useLayout.match(/getResponsivePanelMaxWidth\(window\.innerWidth, RIGHT_PANEL_DEFAULT_WIDTH\)/g))
      .toHaveLength(2);
    // Graph opens narrower than the ceiling but never under the column default.
    expect(useLayout).toContain('Math.max(RIGHT_PANEL_DEFAULT_WIDTH, Math.min(GRAPH_PANEL_DEFAULT_WIDTH, window.innerWidth * PANEL_MAX_VIEWPORT_RATIO))');
  });

  it('reports the real drag bounds on both resize handles', async () => {
    const app = await readFile(appPath, 'utf8');

    // Screen readers announce this range, so it must derive from the constants, not literals.
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

    // A default below min would be clamped up on the first drag, causing a jump.
    expect(initial).toBeGreaterThanOrEqual(min);
    expect(initial).toBeLessThanOrEqual(max);
  });

  it('keeps the responsive sidebar maximum at or above its default', async () => {
    const useLayout = await readFile(useLayoutPath, 'utf8');
    const initial = readSidebarDefault(useLayout);

    // Pointer and keyboard share a viewport cap floored at the default, so narrow desktops don't jump.
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
