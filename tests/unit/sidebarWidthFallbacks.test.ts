import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getResponsivePanelMaxWidth } from '../../src/hooks/useLayout';

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
  const match = useLayout.match(/useResizeDrag\(\s*SIDEBAR_DEFAULT_WIDTH\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*getSidebarValue/);
  if (!match) throw new Error('could not locate the sidebar useResizeDrag call');
  return { min: Number(match[1]), max: Number(match[2]) };
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

    const match = useLayout.match(/useResizeDrag\(\s*(\d+)\s*,\s*\d+\s*,\s*\d+\s*,\s*getRightPanelValue/);
    expect(match).not.toBeNull();
    const expected = Number(match![1]);

    const fallbacks = [
      ...collectFallbacks(app, '--noa-right-panel-width'),
      ...collectFallbacks(topBar, '--noa-right-panel-width'),
    ];

    expect(fallbacks.length).toBeGreaterThan(0);
    for (const value of fallbacks) {
      expect(value).toBe(expected);
    }
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
    // the default width. Otherwise a narrow desktop (for example 800px wide)
    // paints at 325px and jumps down on the first resize interaction.
    expect(getResponsivePanelMaxWidth(800, initial)).toBe(initial);
    expect(getResponsivePanelMaxWidth(928, initial)).toBe(initial);
    expect(getResponsivePanelMaxWidth(1600, initial)).toBe(480);
    expect(useLayout).toContain(
      'getResponsivePanelMaxWidth(window.innerWidth, SIDEBAR_DEFAULT_WIDTH)',
    );
    expect(useLayout.match(/getResponsivePanelMaxWidth\(window\.innerWidth, SIDEBAR_DEFAULT_WIDTH\)/g))
      .toHaveLength(2);
  });
});
