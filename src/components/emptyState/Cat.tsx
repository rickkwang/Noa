import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { PixelLayer, Pixels, type Legend } from './pixels';
import { heart } from './sceneFx';
import { Critter, Z, useFrameSet, usePoseSequence, type Step } from './sceneParts';

/**
 * The desk cat. It sleeps curled up, breathing. A click lifts its head: a
 * slow blink, a yawn, eyes open, an ear flick, a heart — it stays up a few
 * seconds, tail swishing, then puts its head back down. Clicking while it is
 * already up gets another heart.
 *
 * Frames are 15×9 and face left; the bottom row lies on the desk.
 */

// `s` is a shut eye: a short line in the coat's shadow tone, not the pupil colour.
const LEGEND: Legend = { c: 'cat', C: 'cat-2', e: 'eye', s: 'cat-shut', n: 'nose', m: 'mouth', z: 'zz' };

const UP = [
  '.c...c.........',
  '.cc.cc.........',
  '.ccccc.........',
  'ccececc........',
  'cccnccc........',
  '.ccccc..cccc...',
  '.cccccccccccc..',
  '.cccccccccccC..',
  '.CCCCCCCCCCCC..',
];
const swapRows = (base: readonly string[], rows: Record<number, string>) => base.map((row, i) => rows[i] ?? row);

const FRAMES: Record<string, readonly string[]> = {
  // Head down on its paws; `+` is the flank rising on each breath.
  sleep: [
    '...............',
    '...............',
    '.c...c.........',
    '.cc.cc.........',
    '.ccccc..++++...',
    'cssccsc.cccc...',
    'cccnccccccccc..',
    '.cccccccccccC..',
    '.CCCCCCCCCCCC..',
  ],
  drowsy: swapRows(UP, { 3: 'cssccsc........' }),
  up: UP,
  blink: swapRows(UP, { 3: 'ccccccc........' }),
  yawn: swapRows(UP, { 3: 'cssccsc........', 4: 'cccmccc........', 5: '.cmmmc..cccc...' }),
  ear: swapRows(UP, { 0: '.c....c........', 1: '.cc..cc........' }),
};

const WAKE: Step[] = [
  { frame: 'drowsy', ms: 380 },
  { frame: 'yawn', ms: 650 },
  { frame: 'drowsy', ms: 260 },
  { frame: 'blink', ms: 120 },
  { frame: 'up', ms: 420 },
  { frame: 'blink', ms: 110 },
  { frame: 'up', ms: 380 },
  { frame: 'ear', ms: 160 },
  { frame: 'up', ms: 0 },
];
const PURR: Step[] = [{ frame: 'ear', ms: 150 }, { frame: 'up', ms: 140 }, { frame: 'blink', ms: 300 }, { frame: 'up', ms: 0 }];
const SETTLE: Step[] = [{ frame: 'blink', ms: 200 }, { frame: 'drowsy', ms: 700 }, { frame: 'sleep', ms: 0 }];

// Tail swish while awake: three positions, shown one at a time by CSS.
const TAILS = [
  [[13, 7], [14, 6], [14, 5], [14, 4]],
  [[13, 7], [13, 6], [14, 5], [14, 4]],
  [[13, 7], [14, 7], [14, 6], [13, 5]],
] as const;

export default function Cat({ x, y, fxRef }: { x: number; y: number; fxRef: React.RefObject<SVGGElement | null> }) {
  const frames = useFrameSet(FRAMES, LEGEND, 'cat');
  const zz = useMemo(() => [new PixelLayer().sprite(Z, x + 6, y - 1, LEGEND), new PixelLayer().sprite(Z, x + 10, y - 5, LEGEND)], [x, y]);
  const tails = useMemo(() => TAILS.map((cells) => {
    const layer = new PixelLayer();
    cells.forEach(([cx, cy]) => layer.add(x + cx, y + cy, 'cat-2'));
    return layer;
  }), [x, y]);
  const { pose, play, busy, after } = usePoseSequence({ frame: 'sleep' });
  const settleTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const scheduleSettle = useCallback(() => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      play(SETTLE);
    }, 5000);
  }, [play]);

  const onClick = useCallback(() => {
    if (busy.current) return;
    const love = () => { if (fxRef.current) heart(fxRef.current, x + 3, y - 4); };
    if (pose.frame === 'sleep') {
      play(WAKE);
      after(1500, love);
    } else {
      play(PURR);
      love();
    }
    scheduleSettle();
  }, [after, busy, fxRef, play, pose.frame, scheduleSettle, x, y]);

  const awake = pose.frame !== 'sleep';
  return (
    <Critter x={x} y={y} pose={pose} frames={frames} onClick={onClick}>
      {awake ? (
        <g className="nsc-tail">
          {tails.map((layer, k) => <g key={k}><Pixels layer={layer} /></g>)}
        </g>
      ) : (
        <g className="nsc-zz">
          <g><Pixels layer={zz[0]} /></g>
          <g><Pixels layer={zz[1]} /></g>
        </g>
      )}
    </Critter>
  );
}
