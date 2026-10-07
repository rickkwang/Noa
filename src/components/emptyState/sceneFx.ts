/**
 * One-shot effects (a flock, a shooting star, a falling leaf, a wisp of
 * steam). Each is a tiny actor: a draw function called every animation frame
 * that returns the cells to paint at that moment, or null when it is done.
 * Positions are rounded to whole cells, so motion stays on the pixel grid the
 * way hand-animated sprites do, instead of sliding a group with a CSS
 * transform.
 *
 * Actors live in the scene's `fx` group and are not routed through React:
 * re-rendering the scene for something that lasts two seconds is waste.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** x, y, tone, and an optional opacity. */
export type FxCell = readonly [number, number, string, number?];
type Draw = (seconds: number) => readonly FxCell[] | null;

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function runActor(fx: Element, draw: Draw, onDone?: () => void): void {
  // With reduced motion there is no flight, fall or flip — only its outcome.
  if (prefersReducedMotion()) {
    onDone?.();
    return;
  }
  const g = document.createElementNS(SVG_NS, 'g');
  fx.appendChild(g);
  let start = 0;
  let painted = '';
  const tick = (now: number) => {
    if (!start) start = now;
    // A scene that unmounted mid-effect takes the group with it; stop there.
    const cells = g.isConnected ? draw((now - start) / 1000) : null;
    if (!cells) {
      g.remove();
      onDone?.();
      return;
    }
    const key = cells.map((c) => c.join(',')).join(';');
    if (key !== painted) {
      painted = key;
      g.replaceChildren(...cells.map(([x, y, tone, opacity]) => {
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', String(x));
        r.setAttribute('y', String(y));
        r.setAttribute('width', '1');
        r.setAttribute('height', '1');
        r.style.fill = `var(--px-${tone})`;
        if (opacity !== undefined && opacity < 1) r.style.opacity = opacity.toFixed(2);
        return r;
      }));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function cellsOfMap(map: readonly string[], ox: number, oy: number, tone: string, opacity?: number): FxCell[] {
  const out: FxCell[] = [];
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') out.push([ox + x, oy + y, tone, opacity]);
  });
  return out;
}

// ---------- birds ----------

// Wingbeat cycle, body on the middle row: wings raised, the gull "m" of the
// mid-stroke, wings pressed down, and back. Frame 1 doubles as the glide.
const LEAD_BIRD = [['b...b', '.b.b.', '..b..'], ['.....', 'bb.bb', '..b..'], ['.....', '.bbb.', 'b...b'], ['.....', 'bb.bb', '..b..']];
// Distant birds are too small for a level wing; they just alternate a V and its fall.
const SMALL_BIRD = [['b.b', '.b.', '...'], ['...', 'b.b', '.b.'], ['...', '.b.', 'b.b'], ['...', 'b.b', '.b.']];

/**
 * A loose flock crossing from `x0` to `x1`. Each bird keeps its own speed and
 * wingbeat, rises and dips on its own swell, and now and then holds its wings
 * level to glide — the irregularity is what makes it read as birds rather
 * than a sprite on a rail.
 */
export function flock(fx: Element, x0: number, x1: number, y: number): void {
  const count = 3 + Math.floor(Math.random() * 3);
  const birds = Array.from({ length: count }, (_, i) => ({
    dx: i === 0 ? 0 : -i * 5 - Math.random() * 3,
    dy: i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 2.5 + Math.random(),
    speed: 15 + Math.random() * 3,
    beat: 0.09 + Math.random() * 0.03,
    phase: Math.random(),
    lead: i === 0,
  }));
  const fade = 10;
  runActor(fx, (s) => {
    const cells: FxCell[] = [];
    let alive = false;
    for (const b of birds) {
      const x = x0 + b.dx + b.speed * s;
      if (x < x1) alive = true;
      const yy = y + b.dy - s * 0.7 + Math.sin(s * 1.7 + b.phase * 6) * 1.3;
      const gliding = Math.sin(s * 0.9 + b.phase * 9) > 0.82;
      const frame = gliding ? 1 : Math.floor(s / b.beat + b.phase * 4) % 4;
      const map = (b.lead ? LEAD_BIRD : SMALL_BIRD)[frame];
      const w = map[0].length;
      const opacity = clamp01((x - x0) / fade) * clamp01((x1 - x) / fade);
      if (opacity > 0) cells.push(...cellsOfMap(map, Math.round(x - w / 2), Math.round(yy - 1), 'bird', opacity));
    }
    return alive ? cells : null;
  });
}

// ---------- shooting star ----------

/** A bright head that accelerates along a shallow diagonal, its tail growing, then burning out. */
export function shootingStar(fx: Element, x: number, y: number): void {
  const duration = 0.85;
  const travel = 34;
  const [ux, uy] = [0.86, 0.5];
  runActor(fx, (s) => {
    const t = s / duration;
    if (t >= 1) return null;
    const d = travel * t * t * (0.6 + 0.4 * t) + travel * 0.15 * t;
    const burn = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
    const tail = Math.round(2 + Math.min(1, t * 3) * 6);
    const cells: FxCell[] = [];
    const seen = new Set<string>();
    for (let k = tail; k >= 0; k--) {
      const cx = Math.round(x + ux * (d - k));
      const cy = Math.round(y + uy * (d - k));
      const key = `${cx},${cy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push([cx, cy, k === 0 ? 'moon' : 'star', burn * (1 - k / (tail + 1))]);
    }
    return cells;
  });
}

// ---------- leaves ----------

/**
 * A leaf that flutters down: it swings side to side on a slowing pendulum,
 * reads as a dash while it is broadside and a dot while edge-on, then lies on
 * the ground for a moment before fading.
 */
export function fallingLeaf(fx: Element, x: number, y: number, ground: number, tone: string): void {
  const swing = 1.6 + Math.random() * 1.2;
  const rate = 2.6 + Math.random() * 1.2;
  const drift = (Math.random() - 0.3) * 2.5;
  const fall = 5.5 + Math.random() * 2;
  let landedAt = 0;
  let restX = 0;
  runActor(fx, (s) => {
    const yy = y + fall * s;
    if (yy >= ground) {
      if (!landedAt) { landedAt = s; restX = Math.round(x + drift * s + Math.sin(s * rate) * swing); }
      const rest = s - landedAt;
      if (rest > 1.8) return null;
      return [[restX, ground, tone, rest < 1 ? 1 : 1 - (rest - 1) / 0.8], [restX + 1, ground, tone, rest < 1 ? 1 : 1 - (rest - 1) / 0.8]];
    }
    const sway = Math.sin(s * rate);
    const lx = Math.round(x + drift * s + sway * swing);
    const ly = Math.round(yy);
    // Broadside near the middle of the swing, edge-on at its ends.
    return Math.abs(sway) < 0.6 ? [[lx, ly, tone], [lx + 1, ly, tone]] : [[lx, ly, tone]];
  });
}

// ---------- steam, smoke ----------

/** A few wisps that curl upward and thin out. */
export function wisps(fx: Element, x: number, y: number, tone: string, count = 4): void {
  const parts = Array.from({ length: count }, (_, i) => ({
    delay: i * 0.22 + Math.random() * 0.1,
    dx: (Math.random() - 0.5) * 2,
    curl: 1 + Math.random(),
    rise: 7 + Math.random() * 4,
  }));
  const life = 1.5;
  runActor(fx, (s) => {
    const cells: FxCell[] = [];
    let alive = false;
    for (const p of parts) {
      const t = (s - p.delay) / life;
      if (t < 0) { alive = true; continue; }
      if (t >= 1) continue;
      alive = true;
      cells.push([
        Math.round(x + p.dx + Math.sin(t * 5 + p.curl) * p.curl),
        Math.round(y - p.rise * t),
        tone,
        t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8,
      ]);
    }
    return alive ? cells : null;
  });
}

// ---------- heart ----------

const HEART = ['h.h', 'hhh', '.h.'];

/** Pops from a single pixel to a heart, then floats up on a slight sway and fades. */
export function heart(fx: Element, x: number, y: number): void {
  runActor(fx, (s) => {
    if (s > 1.7) return null;
    if (s < 0.08) return [[x + 1, y + 1, 'heart']];
    const t = (s - 0.08) / 1.62;
    const hx = Math.round(x + Math.sin(t * 7) * 0.8);
    const hy = Math.round(y - t * 6);
    return cellsOfMap(HEART, hx, hy, 'heart', t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
  });
}

// ---------- swing ----------

/** A pushed swing: a damped pendulum, rotated about its rope tops. */
export function swingPush(el: SVGGElement): void {
  if (prefersReducedMotion()) return;
  const amp = 16;
  let start = 0;
  const tick = (now: number) => {
    if (!start) start = now;
    const s = (now - start) / 1000;
    const angle = amp * Math.exp(-s / 1.3) * Math.sin(s * 3.4);
    if (s > 4 || !el.isConnected) {
      el.style.removeProperty('rotate');
      return;
    }
    el.style.rotate = `${Math.round(angle * 2) / 2}deg`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** A brief rustle: the group nudges a cell either way, settling. */
export function rustle(el: Element | null): void {
  if (!el || typeof el.animate !== 'function' || prefersReducedMotion()) return;
  el.animate([0, 1, -1, 1, 0, -1, 0].map((d) => ({ transform: `translateX(${d}px)` })), { duration: 520, easing: 'steps(7)' });
}
