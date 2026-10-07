import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelLayer, Pixels, type Legend } from './pixels';
import { Critter, Z, useFrameSet, usePoseSequence, type Pose, type Step } from './sceneParts';

/**
 * The island's rabbit. By day it sits, blinks, sniffs and flicks an ear; a
 * click sends it hopping off a few cells, a look round, and hopping home. By
 * night it sleeps loaf-shaped with its ears laid back; a click wakes it for a
 * while before it settles again.
 *
 * Frames are 12×9 and face left; the bottom row stands on the ground.
 */

const LEGEND: Legend = {
  r: 'rabbit', R: 'rabbit-ear', b: 'rabbit-2', e: 'eye', c: 'rabbit-shut', p: 'nose', t: 'rabbit-tail', z: 'zz',
};

const SIT = [
  '..rr.bb.....',
  '..rR.bb.....',
  '..rR.b......',
  '..rrr.......',
  '.rrrrr......',
  'rerrrr.rrr..',
  'prrrrrrrrrr.',
  '.rrrrrrrrrrt',
  '..bbrrrrbb..',
];
const swapRows = (base: readonly string[], rows: Record<number, string>) => base.map((row, i) => rows[i] ?? row);

const FRAMES: Record<string, readonly string[]> = {
  sit: SIT,
  blink: swapRows(SIT, { 5: 'rrrrrr.rrr..' }),
  twitch: swapRows(SIT, { 0: '..rr..bb....', 1: '..rR..b.....', 2: '..rR.b......' }),
  sniff: swapRows(SIT, { 5: 'perrrr.rrr..', 6: 'rrrrrrrrrrr.' }),
  // Gathering for the jump: low, long, ears swept back.
  crouch: [
    '............',
    '....rr.bb...',
    '.....rRbb...',
    '...rrrR.....',
    '.rrrrr......',
    'rerrrrrrrr..',
    'prrrrrrrrrrr',
    '.rrrrrrrrrrt',
    '.bbbrrrrrbb.',
  ],
  // Mid-air: stretched out, forelegs reaching, hind legs trailing.
  leap: [
    '......bb....',
    '.....rRb....',
    '....rRr.....',
    '..rrrr......',
    '.rrrrrrrrrr.',
    'rerrrrrrrrrr',
    'prrrrrrrrrrt',
    '.bb.....bbb.',
    '............',
  ],
  drowsy: [
    '............',
    '..rr.bb.....',
    '..rR.b......',
    '..rrr.......',
    '.rrrrr......',
    'rccrrr.rrr..',
    'prrrrrrrrrr.',
    '.rrrrrrrrrrt',
    '..bbrrrrbb..',
  ],
  // Asleep: ears laid flat along the back; `+` is the back rising on each breath.
  sleep: [
    '............',
    '............',
    '............',
    '...rrRRRbb..',
    '.rrrrr+++...',
    'rccrrrrrrr..',
    'prrrrrrrrrr.',
    '.rrrrrrrrrrt',
    '..bbrrrrbb..',
  ],
};

function hop(from: number, to: number, flip: boolean): Step[] {
  const s = Math.sign(to - from);
  return [
    { frame: 'crouch', dx: from, flip, ms: 110 },
    { frame: 'leap', dx: from + s, dy: -2, flip, ms: 70 },
    { frame: 'leap', dx: from + s * 2, dy: -3, flip, ms: 80 },
    { frame: 'leap', dx: from + s * 3, dy: -2, flip, ms: 70 },
    { frame: 'crouch', dx: to, flip, ms: 120 },
    { frame: 'sit', dx: to, flip, ms: 200 },
  ];
}

const OUTING: Step[] = [
  ...hop(0, -4, false),
  ...hop(-4, -8, false),
  { frame: 'sniff', dx: -8, ms: 110 },
  { frame: 'sit', dx: -8, ms: 110 },
  { frame: 'sniff', dx: -8, ms: 110 },
  { frame: 'sit', dx: -8, ms: 420 },
  { frame: 'twitch', dx: -8, ms: 160 },
  { frame: 'sit', dx: -8, flip: true, ms: 380 },
  ...hop(-8, -4, true),
  ...hop(-4, 0, true),
  { frame: 'blink', dx: 0, flip: true, ms: 120 },
  { frame: 'sit', dx: 0, flip: true, ms: 520 },
  { frame: 'sit', ms: 0 },
];

const WAKE: Step[] = [
  { frame: 'drowsy', ms: 420 },
  { frame: 'blink', ms: 200 },
  { frame: 'sit', ms: 260 },
  { frame: 'blink', ms: 110 },
  { frame: 'sit', ms: 360 },
  { frame: 'twitch', ms: 170 },
  { frame: 'sit', ms: 0 },
];

const SETTLE: Step[] = [
  { frame: 'blink', ms: 160 },
  { frame: 'drowsy', ms: 600 },
  { frame: 'sleep', ms: 0 },
];

const IDLES: Step[][] = [
  [{ frame: 'blink', ms: 130 }, { frame: 'sit', ms: 0 }],
  [{ frame: 'twitch', ms: 150 }, { frame: 'sit', ms: 90 }, { frame: 'twitch', ms: 140 }, { frame: 'sit', ms: 0 }],
  [{ frame: 'sniff', ms: 100 }, { frame: 'sit', ms: 100 }, { frame: 'sniff', ms: 100 }, { frame: 'sit', ms: 100 }, { frame: 'sniff', ms: 100 }, { frame: 'sit', ms: 0 }],
];

export default function Rabbit({ x, y, night }: { x: number; y: number; night: boolean }) {
  const frames = useFrameSet(FRAMES, LEGEND, 'rabbit');
  const zz = useMemo(() => [new PixelLayer().sprite(Z, x + 5, y - 2, LEGEND), new PixelLayer().sprite(Z, x + 9, y - 6, LEGEND)], [x, y]);
  const [roused, setRoused] = useState(false);
  const asleep = night && !roused;
  const rest: Pose = asleep ? { frame: 'sleep' } : { frame: 'sit' };
  const { pose, setPose, play, stop, busy } = usePoseSequence(rest);
  const rouseTimer = useRef(0);

  // Night falls or lifts: drop whatever it was doing and take the resting pose.
  useEffect(() => {
    stop();
    window.clearTimeout(rouseTimer.current);
    setRoused(false);
    setPose(night ? { frame: 'sleep' } : { frame: 'sit' });
  }, [night, setPose, stop]);
  useEffect(() => () => window.clearTimeout(rouseTimer.current), []);

  // Small idle business while awake and at home.
  useEffect(() => {
    if (asleep) return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!busy.current) play(IDLES[Math.floor(Math.random() * IDLES.length)]);
        schedule();
      }, 2200 + Math.random() * 2600);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [asleep, busy, play]);

  const onClick = useCallback(() => {
    if (asleep) {
      setRoused(true);
      play(WAKE);
      window.clearTimeout(rouseTimer.current);
      // Settle back down after a while, but never mid-hop: wait for it to get home.
      const settle = () => {
        if (busy.current) { rouseTimer.current = window.setTimeout(settle, 300); return; }
        play(SETTLE, () => setRoused(false));
      };
      rouseTimer.current = window.setTimeout(settle, 5200);
      return;
    }
    if (busy.current) return;
    play(OUTING);
  }, [asleep, busy, play]);

  return (
    <Critter x={x} y={y} pose={pose} frames={frames} onClick={onClick}>
      {pose.frame === 'sleep' && (
        <g className="nsc-zz">
          <g><Pixels layer={zz[0]} /></g>
          <g><Pixels layer={zz[1]} /></g>
        </g>
      )}
    </Critter>
  );
}
