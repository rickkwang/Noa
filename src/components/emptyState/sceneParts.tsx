import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { PixelLayer, Pixels, type Legend } from './pixels';
import { prefersReducedMotion, shootingStar } from './sceneFx';

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';

/** 0 notes · 1–9 · 10–49 · 50–199 · 200–499 · 500+ */
export type Tier = 0 | 1 | 2 | 3 | 4 | 5;
const TIER_THRESHOLDS = [0, 1, 10, 50, 200, 500] as const;

export function tierForCount(count: number): Tier {
  let tier = 0;
  TIER_THRESHOLDS.forEach((min, index) => { if (count >= min) tier = index; });
  return tier as Tier;
}

export interface SceneProps {
  tier: Tier;
  phase: Phase;
}

const CLOUD = ['...qqq....', '.qqqqqqq..', 'qqqqqqqqqq'];
const SKY: Legend = { q: 'cloud' };

export const Z = ['zzzz', '..z.', '.z..', 'zzzz'];

export function Stars({ points }: { points: readonly (readonly [number, number])[] }) {
  return (
    <g className="nsc-stars">
      {points.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} style={{ fill: 'var(--px-star)' }} />)}
    </g>
  );
}

const DISC = 9;
const R = DISC / 2;
/** Cell centres of a 9×9 disc, relative to its middle. */
const DISC_CELLS = Array.from({ length: DISC * DISC }, (_, i) => {
  const x = i % DISC;
  const y = Math.floor(i / DISC);
  const px = x + 0.5 - R;
  const py = y + 0.5 - R;
  return { x, y, px, py, d: Math.hypot(px, py) };
}).filter(({ d }) => d <= R - 0.05);

function sunLayer(): PixelLayer {
  const layer = new PixelLayer();
  for (const { x, y, px, py, d } of DISC_CELLS) {
    // Lit from the upper left: bright off-centre core, deeper rim lower right.
    let tone = 'sun';
    if (d > R - 1.1 && px + py > 1) tone = 'sun-rim';
    else if (Math.hypot(px + 1.2, py + 1.2) < 1.6) tone = 'sun-hi';
    layer.add(x, y, tone);
  }
  return layer;
}

/** Days into the current lunation, from a known new moon (2000-01-06 18:14 UTC). */
function moonAge(date: Date): number {
  const SYNODIC = 29.530588853;
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000;
  return ((days % SYNODIC) + SYNODIC) % SYNODIC;
}

/**
 * Tonight's actual moon. Each row is lit up to a terminator at
 * w·cos(θ), where θ runs 0 (new) → π (full) → 2π; waxing is lit on the right,
 * as seen from the northern hemisphere. The unlit side is drawn faintly, the
 * way earthshine leaves a thin moon's full disc just visible.
 */
function moonLayer(age: number): PixelLayer {
  // Keep at least a slim crescent near new moon so there's still a moon to click.
  const shown = Math.min(Math.max(age, 2.6), 29.530588853 - 2.6);
  const theta = (shown / 29.530588853) * Math.PI * 2;
  const waxing = theta < Math.PI;
  const layer = new PixelLayer();
  const craters = new Set(['3,2', '5,5', '2,5', '6,3']);
  for (const { x, y, px, py } of DISC_CELLS) {
    const w = Math.sqrt(Math.max(0, R * R - py * py));
    const t = w * Math.cos(theta);
    const lit = waxing ? px > t : px < -t;
    const nearEdge = waxing ? px - t < 1 : -t - px < 1;
    let tone = 'moon-dark';
    if (lit) tone = nearEdge || craters.has(`${x},${y}`) ? 'moon-2' : 'moon';
    layer.add(x, y, tone);
  }
  return layer;
}

/** Positioned per scene and phase in CSS, so changing the hour slides it rather than redrawing. */
export function Sun({ onClick }: { onClick: () => void }) {
  const id = useId();
  const layer = useMemo(sunLayer, []);
  return (
    <g className="nsc-sun nsc-hit" onClick={onClick}>
      <defs>
        <radialGradient id={`${id}-sun`}>
          <stop offset="0.35" style={{ stopColor: 'var(--px-sun)', stopOpacity: 0.45 }} />
          <stop offset="1" style={{ stopColor: 'var(--px-sun)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <circle className="nsc-sun-glow" cx={R} cy={R} r={11} fill={`url(#${id}-sun)`} />
      <Pixels layer={layer} />
    </g>
  );
}

export function Moon({ x, y, onClick }: { x: number; y: number; onClick: () => void }) {
  const id = useId();
  const day = new Date().toDateString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed once per calendar day
  const age = useMemo(() => moonAge(new Date()), [day]);
  const layer = useMemo(() => moonLayer(age), [age]);
  // Full moon glows brighter than a crescent.
  const lit = (1 - Math.cos((age / 29.530588853) * Math.PI * 2)) / 2;
  return (
    <g className="nsc-moon nsc-hit" onClick={onClick}>
      <defs>
        <radialGradient id={`${id}-moon`}>
          <stop offset="0.4" style={{ stopColor: 'var(--px-moon)', stopOpacity: 0.3 }} />
          <stop offset="1" style={{ stopColor: 'var(--px-moon)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <circle cx={x + R} cy={y + R} r={10} fill={`url(#${id}-moon)`} style={{ opacity: 0.35 + lit * 0.65 }} />
      <g transform={`translate(${x} ${y})`}><Pixels layer={layer} /></g>
    </g>
  );
}

export function Clouds({ a, b }: { a: readonly [number, number]; b: readonly [number, number] }) {
  const [first, second] = useMemo(() => [
    new PixelLayer().sprite(CLOUD, a[0], a[1], SKY),
    new PixelLayer().sprite(CLOUD, b[0], b[1], SKY),
  ], [a, b]);
  return (
    <g className="nsc-clouds">
      <g className="nsc-cloud-a"><Pixels layer={first} /></g>
      <g className="nsc-cloud-b"><Pixels layer={second} /></g>
    </g>
  );
}

/**
 * Lamps follow the hour (on at dusk and night) until someone clicks one; the
 * click sticks until the phase changes.
 */
export function useLamps(phase: Phase) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => { setOverrides({}); }, [phase]);
  const dark = phase === 'dusk' || phase === 'night';
  const isLit = useCallback((id: string) => overrides[id] ?? dark, [overrides, dark]);
  const toggle = useCallback((id: string) => {
    setOverrides((prev) => ({ ...prev, [id]: !(prev[id] ?? dark) }));
  }, [dark]);
  return { isLit, toggle };
}

/** Now and then, on a night sky nobody touched, a star falls on its own. */
export function useAmbientShootingStars(
  fxRef: React.RefObject<SVGGElement | null>,
  phase: Phase,
  pick: () => readonly [number, number],
) {
  useEffect(() => {
    if (phase !== 'night' || prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      if (document.hidden || Math.random() >= 0.15 || !fxRef.current) return;
      const [x, y] = pick();
      shootingStar(fxRef.current, x, y);
    }, 9000);
    return () => window.clearInterval(timer);
  }, [fxRef, phase, pick]);
}

/**
 * A pose names a frame and where to draw it relative to the character's
 * resting spot. Frames are drawn facing left; `flip` mirrors in place.
 */
export interface Pose {
  frame: string;
  dx?: number;
  dy?: number;
  flip?: boolean;
}
export interface Step extends Pose {
  ms: number;
}

/** `+` in a frame is a breathing cell: drawn only on the in-breath while asleep. */
const BREATH = '+';

function mirror(map: readonly string[]): string[] {
  const width = Math.max(...map.map((row) => row.length));
  return map.map((row) => [...row.padEnd(width, '.')].reverse().join(''));
}

interface FrameLayers { body: PixelLayer; breath: PixelLayer }

function frameLayers(map: readonly string[], legend: Legend, breathTone: string): FrameLayers {
  const body = new PixelLayer();
  const breath = new PixelLayer();
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === BREATH) breath.add(x, y, breathTone);
      else if (legend[row[x]]) body.add(x, y, legend[row[x]]);
    }
  });
  return { body, breath };
}

export function useFrameSet(frames: Readonly<Record<string, readonly string[]>>, legend: Legend, breathTone: string) {
  return useMemo(() => {
    const out: Record<string, { left: FrameLayers; right: FrameLayers }> = {};
    for (const [name, map] of Object.entries(frames)) {
      out[name] = { left: frameLayers(map, legend, breathTone), right: frameLayers(mirror(map), legend, breathTone) };
    }
    return out;
  }, [frames, legend, breathTone]);
}

export function Critter({ x, y, pose, frames, className, onClick, children }: {
  x: number;
  y: number;
  pose: Pose;
  frames: ReturnType<typeof useFrameSet>;
  className?: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  const set = frames[pose.frame];
  const layers = pose.flip ? set.right : set.left;
  return (
    <g className={`nsc-hit ${className ?? ''}`} onClick={onClick}>
      <g transform={`translate(${x + (pose.dx ?? 0)} ${y + (pose.dy ?? 0)})`}>
        <Pixels layer={layers.body} />
        <g className="nsc-breathe"><Pixels layer={layers.breath} /></g>
      </g>
      {children}
    </g>
  );
}

/**
 * Plays a timed run of poses. A new run replaces whatever is playing. With
 * reduced motion, a run jumps straight to its last pose.
 */
export function usePoseSequence(initial: Pose) {
  const [pose, setPose] = useState<Pose>(initial);
  const timers = useRef<number[]>([]);
  const busy = useRef(false);

  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    busy.current = false;
  }, []);
  useEffect(() => stop, [stop]);

  const play = useCallback((steps: readonly Step[], done?: () => void) => {
    stop();
    if (steps.length === 0) return;
    busy.current = true;
    const reduced = prefersReducedMotion();
    const run = reduced ? [{ ...steps[steps.length - 1], ms: 0 }] : steps;
    let at = 0;
    for (const step of run) {
      timers.current.push(window.setTimeout(() => setPose(step), at));
      at += step.ms;
    }
    timers.current.push(window.setTimeout(() => { busy.current = false; done?.(); }, at));
  }, [stop]);

  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  return { pose, setPose, play, stop, after, busy };
}
