import React from 'react';

/**
 * Pixel art for the empty-state scenes. Every cell is one viewBox unit; the
 * scene is sized so a unit lands on whole device pixels on a 2x display.
 *
 * A tone names a CSS custom property (`--px-<tone>`, defined in
 * emptyState.css for light and dark) rather than a colour. Cells are batched
 * into one <path> per tone so a scene is a few dozen nodes, not thousands of
 * <rect>s.
 */

export type Legend = Readonly<Record<string, string>>;

export class PixelLayer {
  private readonly tones = new Map<string, string[]>();

  add(x: number, y: number, tone: string): this {
    let cells = this.tones.get(tone);
    if (!cells) {
      cells = [];
      this.tones.set(tone, cells);
    }
    cells.push(`M${x} ${y}h1v1h-1z`);
    return this;
  }

  /** Rows of characters; `.` is empty, anything else is looked up in `legend`. */
  sprite(map: readonly string[], ox: number, oy: number, legend: Legend): this {
    map.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const tone = legend[row[x]];
        if (tone) this.add(ox + x, oy + y, tone);
      }
    });
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, tone: string): this {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      this.add(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), tone);
    }
    return this;
  }

  paths(): { tone: string; d: string }[] {
    return [...this.tones].map(([tone, cells]) => ({ tone, d: cells.join('') }));
  }
}

export function Pixels({ layer }: { layer: PixelLayer }) {
  return (
    <>
      {layer.paths().map(({ tone, d }) => (
        <path key={tone} d={d} style={{ fill: `var(--px-${tone})` }} />
      ))}
    </>
  );
}

/** Deterministic noise in [0, 1): the same scene draws identically on every visit. */
export function hash(x: number, y: number, seed = 0): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

/** Floating-island cross-section: flat grassy top, earth tapering to a point, a few hanging vines. */
export function drawIsland(layer: PixelLayer, cx: number, top: number, halfWidth: number, depth: number, seed: number): void {
  const bottom = new Map<number, number>();
  for (let r = 0; r <= depth; r++) {
    const t = r / depth;
    const hw = Math.max(0, Math.round(halfWidth * (1 - Math.pow(t, 1.3)) + (r > 1 ? Math.sin(r * 1.9 + seed) * 0.8 : 0)));
    const c = cx + Math.round(Math.sin(r * 0.55 + seed) * 1.4 * t);
    for (let x = c - hw; x <= c + hw; x++) {
      const rel = (x - c) / Math.max(hw, 1);
      let tone: string;
      if (r === 0) tone = 'grass';
      else if (r === 1) tone = hash(x, r, seed) < 0.35 ? 'grass' : 'grass-2';
      else if (r === 2) tone = x % 2 ? 'grass-2' : 'earth';
      else {
        tone = rel > 0.45 ? 'earth-2' : 'earth';
        if (r > depth * 0.62) tone = rel > 0.1 ? 'earth-3' : 'earth-2';
        if (r > 3 && hash(x, r, seed) < 0.05) tone = 'rock';
      }
      layer.add(x, top + r, tone);
      bottom.set(x, r);
    }
  }
  for (const [x, r] of bottom) {
    if (r <= 4 || hash(x, 99, seed) >= 0.07) continue;
    const len = 2 + Math.floor(hash(x, 7, seed) * 4);
    for (let k = 1; k <= len; k++) layer.add(x, top + r + k, 'vine');
  }
}
