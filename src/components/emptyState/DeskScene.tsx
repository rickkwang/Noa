import React, { useCallback, useMemo, useRef, useState } from 'react';
import Cat from './Cat';
import { PixelLayer, Pixels, drawIsland, hash, type Legend } from './pixels';
import { flock, rustle, runActor, shootingStar, wisps, type FxCell } from './sceneFx';
import { Clouds, Moon, Stars, Sun, useAmbientShootingStars, useLamps, type SceneProps } from './sceneParts';

/**
 * A desk under a window. The sky only changes inside the glass. The desk
 * gathers things as the workspace grows: coffee, a reading lamp, a plant on
 * the sill, a shelf, fairy lights — and at 500 notes the island from the
 * other scene floats in the distance. A cat sleeps on the desk.
 */

const WIN = { x0: 50, x1: 99, y0: 6, y1: 49 }; // outer edge of the frame
const GLASS = { x: WIN.x0 + 2, y: WIN.y0 + 2, w: WIN.x1 - WIN.x0 - 3, h: WIN.y1 - WIN.y0 - 3 };
const TOP = 74; // desk surface row
const CAT_X = 103;

const L: Legend = {
  P: 'paper', p: 'paper-2', i: 'ink-line', c: 'cover', u: 'gutter', r: 'ribbon',
  m: 'mug-2', M: 'mug', S: 'shade', s: 'shade-2', y: 'lamp', a: 'metal',
  '1': 'book-1', '2': 'book-2', '3': 'book-3', '4': 'book-4',
  l: 'leaf', L: 'leaf-2', t: 'pot', T: 'pot-2', F: 'frame-2', N: 'canopy', k: 'trunk', g: 'grass', e: 'earth',
  f: 'lotus', Y: 'buttercup',
};

// A slim open book seen from just above: pages dipping into the gutter, a
// thin cover under them, a ribbon marker trailing onto the desk.
const BOOK = [
  '..PPPPPPPP..PPPPPPPP..',
  '.PPPPPPPPPuuPPPPPPPPP.',
  '.PPPPPPPPPuuPPPPPPPPP.',
  'cccccccccccccccccccccc',
  '...........r..........',
];
const BOOK_X = 56;
const BOOK_Y = TOP - 4;
const GUTTER = BOOK_X + 11; // the right-hand of the two gutter columns
const MUG = ['mmmmm..', 'MMMMMMM', 'MMMMM.M', 'MMMMM.M', 'MMMMMM.', '.MMM...'];
const BOOKS = ['...111111111..', '...1pppppppp..', '.2222222222...', '.2pppppppppp..', '..33333333333.', '..3pppppppppp.'];
const SHADE = ['..SSSS..', '.SSSSSS.', 'SSSSSSSS', 'ssssssss', '...yy...'];
const PLANT = ['..l.l..', '.lLl.l.', 'l.lLl.l', '.l.L.lL', '..lLl..', '...L...', '.ttttt.', '.TTTTT.', '..TTT..'];
// A bud that opens over three frames.
const BLOOMS = [['.....', '..f..', '.....'], ['.....', '.fYf.', '..f..'], ['..f..', '.fYf.', '..f..']];
const SUCCULENT = ['.l.l.', 'lLlLl', '.lLl.', 'ttttt', '.TTT.'];
// The island scene, framed — a nod between the two.
const PICTURE = [
  'FFFFFFFFFFFFFFF', 'FPPPPPPPPPPPPPF', 'FPPPPPPPPPPPPPF', 'FPPPPPNNPPPPPPF', 'FPPPPNNNNPPPPPF', 'FPPPPPkPPPPPPPF',
  'FPPPgggggggPPPF', 'FPPPPeeeeePPPPF', 'FPPPPPPeePPPPPF', 'FPPPPPPPPPPPPPF', 'FFFFFFFFFFFFFFF',
];

const STARS = [[56, 11], [63, 16], [70, 10], [79, 13], [87, 9], [93, 17], [58, 22], [67, 24], [85, 21], [95, 24], [80, 33], [61, 35]] as const;
const CLOUD_A = [44, 14] as const;
const CLOUD_B = [40, 31] as const;
const BULB_XS = Array.from({ length: 9 }, (_, k) => 50 + k * 6);
const lightsY = (x: number) => 5 + Math.round(4 * (1 - ((x - 74.5) / 28) ** 2));

function drawFrame(layer: PixelLayer) {
  for (let y = WIN.y0; y <= WIN.y1; y++) {
    for (let x = WIN.x0; x <= WIN.x1; x++) {
      const edge = x < WIN.x0 + 2 || x > WIN.x1 - 2 || y < WIN.y0 + 2 || y > WIN.y1 - 2;
      const mullion = x === 74 || x === 75 || y === 27 || y === 28;
      if (!edge && !mullion) continue;
      const inner = (x === WIN.x0 + 1 && y > WIN.y0) || (y === WIN.y0 + 1 && x > WIN.x0) || x === 75 || y === 28;
      layer.add(x, y, inner ? 'frame-2' : 'frame');
    }
  }
  for (let x = WIN.x0 - 3; x <= WIN.x1 + 3; x++) layer.add(x, WIN.y1 + 1, 'frame').add(x, WIN.y1 + 2, 'frame-2');
}

function drawHills(layer: PixelLayer) {
  for (let x = GLASS.x; x < GLASS.x + GLASS.w; x++) {
    const h = 3 + Math.round(2.4 * Math.sin(x / 7 + 1) + 1.2 * Math.sin(x / 3.1));
    for (let y = WIN.y1 - 1 - h; y <= WIN.y1 - 2; y++) layer.add(x, y, y === WIN.y1 - 1 - h ? 'hill-2' : 'hill');
  }
}

function drawDesk(layer: PixelLayer) {
  for (let x = 14; x <= 136; x++) layer.add(x, TOP, 'desk').add(x, TOP + 1, 'desk-2');
  for (let x = 17; x <= 133; x++) for (let y = TOP + 2; y <= TOP + 4; y++) layer.add(x, y, y === TOP + 4 ? 'desk-2' : 'desk');
  for (let y = TOP + 5; y <= 95; y++) for (const x of [19, 20, 21, 129, 130, 131]) layer.add(x, y, x === 21 || x === 131 ? 'desk-2' : 'desk');
  // drawer pulls
  layer.add(70, TOP + 3, 'desk-2').add(71, TOP + 3, 'desk-2').add(80, TOP + 3, 'desk-2').add(81, TOP + 3, 'desk-2');
}

function drawShelf(layer: PixelLayer) {
  for (let x = 4; x <= 40; x++) layer.add(x, 42, 'desk').add(x, 43, 'desk-2');
  for (const x of [8, 36]) layer.add(x, 44, 'desk-2').add(x + 1, 44, 'desk-2').add(x, 45, 'desk-2');
  const tones = ['book-1', 'book-2', 'book-3', 'book-4', 'paper-2'];
  let x = 6;
  for (let k = 0; x < 31; k++) {
    const w = hash(k, 1) < 0.4 ? 3 : 2;
    const h = 6 + Math.floor(hash(k, 2) * 5);
    for (let dx = 0; dx < w; dx++) for (let y = 42 - h; y < 42; y++) layer.add(x + dx, y, tones[k % tones.length]);
    x += w + (hash(k, 3) < 0.2 ? 1 : 0);
  }
  layer.sprite(SUCCULENT, 34, 37, L);
}

function drawLampBody(layer: PixelLayer) {
  for (let x = 38; x <= 44; x++) layer.add(x, TOP - 1, 'desk-2');
  for (let x = 39; x <= 43; x++) layer.add(x, TOP - 2, 'metal');
  layer.line(41, TOP - 3, 47, TOP - 11, 'metal');
  layer.add(47, TOP - 11, 'shade-2');
  layer.line(46, TOP - 12, 43, TOP - 16, 'metal');
  layer.sprite(SHADE, 38, TOP - 19, L);
}

function buildLayers(tier: SceneProps['tier']) {
  const frame = new PixelLayer();
  drawFrame(frame);
  const hills = new PixelLayer();
  drawHills(hills);
  const distantIsland = new PixelLayer();
  if (tier >= 5) {
    drawIsland(distantIsland, 89, 39, 3, 3, 2.1);
    distantIsland.add(88, 37, 'canopy').add(89, 37, 'canopy').add(89, 38, 'trunk');
  }
  const room = new PixelLayer();
  drawDesk(room);
  if (tier >= 2) room.sprite(BOOKS, 22, TOP - 6, L);
  if (tier >= 4) { drawShelf(room); room.sprite(PICTURE, 112, 18, L); }

  const wire = new PixelLayer();
  for (let x = 46; x <= 103; x++) wire.add(x, lightsY(x), 'ink-line');
  wire.add(46, 4, 'frame-2').add(103, 4, 'frame-2');

  const lamp = new PixelLayer();
  drawLampBody(lamp);

  return {
    frame, hills, distantIsland, room, wire, lamp,
    book: new PixelLayer().sprite(BOOK, BOOK_X, BOOK_Y, L),
    mug: new PixelLayer().sprite(MUG, 88, TOP - 6, L),
    plant: new PixelLayer().sprite(PLANT, 85, WIN.y1 - 8, L),
    blooms: BLOOMS.map((map) => new PixelLayer().sprite(map, 84, WIN.y1 - 11, L)),
  };
}

/** One line of handwriting on page `n` — a few words of varying length, the same every time page n comes round. */
function pageLines(layer: PixelLayer, n: number, x0: number) {
  let x = x0;
  for (let word = 0; x < x0 + 7; word++) {
    const len = 1 + Math.floor(hash(n, word) * 3);
    for (let k = 0; k < len && x < x0 + 7; k++, x++) layer.add(x, BOOK_Y + 1, 'ink-line');
    x++;
  }
}

/**
 * A page turning over the spine, frame by frame: the corner lifts, the page
 * curls, stands on edge above the gutter, then falls open on the left. Each
 * frame lists columns counted out from the gutter, with the rows covered
 * (relative to the page's top line).
 */
type PageFrame = readonly (readonly [col: number, top: number, bottom: number])[];
const PAGE_FRAMES: readonly PageFrame[] = [
  [[1, 0, 2], [2, 0, 2], [3, 0, 2], [4, 0, 2], [5, 0, 2], [6, -1, 1], [7, -1, 1], [8, -2, 0], [9, -2, 0]],
  [[1, 0, 2], [2, 0, 2], [3, 0, 2], [4, -2, 0], [5, -2, 0], [6, -4, -2], [7, -4, -2]],
  [[1, -2, 1], [2, -2, 1], [3, -5, -2], [4, -5, -2]],
];
const STANDING: PageFrame = [[0, -7, 1]];

function turnPage(fx: Element, onDone: () => void) {
  const top = BOOK_Y;
  // Right-hand frames are drawn right of the gutter; mirrored ones land left of it.
  const run: { frame: PageFrame; side: 1 | -1 }[] = [
    ...PAGE_FRAMES.map((frame) => ({ frame, side: 1 as const })),
    { frame: STANDING, side: 1 },
    ...[...PAGE_FRAMES].reverse().map((frame) => ({ frame, side: -1 as const })),
  ];
  const frameMs = 0.085;
  runActor(fx, (s) => {
    const step = run[Math.floor(s / frameMs)];
    if (!step) return null;
    const cells: FxCell[] = [];
    const edge = Math.max(...step.frame.map(([col]) => col));
    for (const [col, t, b] of step.frame) {
      const xs = col === 0 ? [GUTTER - 1, GUTTER] : [step.side === 1 ? GUTTER + col : GUTTER - 1 - col];
      for (const x of xs) {
        for (let y = top + t; y <= top + b; y++) {
          // The free edge and the curl's underside are shaded so the page reads against the wall.
          cells.push([x, y, y === top + b || col === edge ? 'paper-2' : 'paper']);
        }
      }
    }
    return cells;
  }, onDone);
}

export default function DeskScene({ tier, phase }: SceneProps) {
  const skyFxRef = useRef<SVGGElement>(null);
  const roomFxRef = useRef<SVGGElement>(null);
  const plantRef = useRef<SVGGElement>(null);
  const layers = useMemo(() => buildLayers(tier), [tier]);
  const { isLit, toggle } = useLamps(phase);
  const [bloom, setBloom] = useState(-1);
  // Page numbers showing on each side; a turn reveals the next spread.
  const [spread, setSpread] = useState({ left: 0, right: 1 });
  const turning = useRef(false);
  const writing = useMemo(() => {
    const layer = new PixelLayer();
    pageLines(layer, spread.left, BOOK_X + 2);
    pageLines(layer, spread.right, BOOK_X + 13);
    return layer;
  }, [spread]);

  const onBook = () => {
    if (turning.current || !roomFxRef.current) return;
    turning.current = true;
    // The page lifting off the right uncovers the next right-hand page at once;
    // its back lands on the left only when the turn finishes.
    setSpread((sp) => ({ ...sp, right: sp.right + 2 }));
    turnPage(roomFxRef.current, () => {
      setSpread((sp) => ({ ...sp, left: sp.left + 2 }));
      turning.current = false;
    });
  };

  const pickStar = useCallback(() => [56 + Math.round(Math.random() * 14), 10 + Math.round(Math.random() * 3)] as const, []);
  useAmbientShootingStars(skyFxRef, phase, pickStar);

  const onPlant = () => {
    rustle(plantRef.current);
    if (bloom >= 0) return;
    [0, 1, 2].forEach((k) => window.setTimeout(() => setBloom(k), 260 + k * 220));
  };

  return (
    <>
      <defs>
        <clipPath id="nsc-desk-glass"><rect x={GLASS.x} y={GLASS.y} width={GLASS.w} height={GLASS.h} /></clipPath>
        <linearGradient id="nsc-lamp-light" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--px-lamp-lit)', stopOpacity: 'var(--nsc-cone-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--px-lamp-lit)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <g clipPath="url(#nsc-desk-glass)">
        <rect x={GLASS.x} y={GLASS.y} width={GLASS.w} height={GLASS.h} className="nsc-glass" />
        <Stars points={STARS} />
        <Sun onClick={() => skyFxRef.current && flock(skyFxRef.current, GLASS.x - 4, GLASS.x + GLASS.w + 4, 18)} />
        <Moon x={57} y={11} onClick={() => skyFxRef.current && shootingStar(skyFxRef.current, ...pickStar())} />
        <Clouds a={CLOUD_A} b={CLOUD_B} />
        {tier >= 5 && <g className="nsc-bob-slow"><Pixels layer={layers.distantIsland} /></g>}
        <Pixels layer={layers.hills} />
        <g ref={skyFxRef} />
      </g>
      <Pixels layer={layers.frame} />

      {tier >= 3 && (
        <g ref={plantRef} className="nsc-hit" onClick={onPlant}>
          <Pixels layer={layers.plant} />
          {bloom >= 0 && <Pixels layer={layers.blooms[bloom]} />}
        </g>
      )}
      {tier >= 5 && (
        <g className={`nsc-hit nsc-lights${isLit('lights') ? ' is-lit' : ''}`} onClick={() => toggle('lights')}>
          <Pixels layer={layers.wire} />
          <g className="nsc-bulbs">
            {BULB_XS.map((x, i) => (
              <rect key={x} x={x} y={lightsY(x) + 1} width={1} height={1} style={{ '--i': i } as React.CSSProperties} />
            ))}
          </g>
        </g>
      )}

      <Pixels layer={layers.room} />
      {tier >= 2 && (
        <g className={`nsc-hit nsc-lamp${isLit('desklamp') ? ' is-lit' : ''}`} onClick={() => toggle('desklamp')}>
          <polygon className="nsc-cone" points={`40,${TOP - 14} 44,${TOP - 14} 68,${TOP} 28,${TOP}`} />
          <Pixels layer={layers.lamp} />
        </g>
      )}
      <g className="nsc-hit" onClick={onBook}>
        <Pixels layer={layers.book} />
        <Pixels layer={writing} />
      </g>
      {tier >= 1 && (
        <g className="nsc-hit" onClick={() => roomFxRef.current && wisps(roomFxRef.current, 90, TOP - 8, 'steam', 6)}>
          <g className="nsc-steam">
            {[[89, TOP - 9], [91, TOP - 10], [90, TOP - 9]].map(([x, y], k) => (
              <rect key={k} x={x} y={y} width={1} height={1} style={{ fill: 'var(--px-steam)' }} />
            ))}
          </g>
          <Pixels layer={layers.mug} />
        </g>
      )}
      <Cat x={CAT_X} y={TOP - 9} fxRef={roomFxRef} />
      <g ref={roomFxRef} />
    </>
  );
}
