import React, { useCallback, useMemo, useRef } from 'react';
import { PixelLayer, Pixels, drawIsland, hash, type Legend } from './pixels';
import Rabbit from './Rabbit';
import { fallingLeaf, flock, rustle, shootingStar, swingPush } from './sceneFx';
import { Clouds, Moon, Stars, Sun, useAmbientShootingStars, useLamps, type SceneProps } from './sceneParts';

/**
 * A floating island that fills in as the workspace grows: a sprout, a sapling,
 * a full tree with a stone lantern, a hut, a swing, and at 500 notes a second
 * islet drifting alongside. A rabbit lives here; it naps at night.
 */

const Y0 = 62; // grass row of the main island
const TREE_X = 48;
const RABBIT_X = 64;

const L: Legend = {
  g: 'grass', G: 'grass-2', l: 'leaf', L: 'leaf-2', N: 'canopy', n: 'canopy-2', k: 'trunk',
  o: 'stone', O: 'stone-2', y: 'lamp', f: 'roof', F: 'roof-2', w: 'wall', W: 'wall-2', d: 'door', x: 'pane', s: 'chimney',
  v: 'iris', Y: 'buttercup',
};

const SPROUT = ['ll.ll', '.lLl.', '..L..', '..L..'];
const SAPLING = ['...lll...', '.lllllll.', 'llllLllll', '.lLllllL.', '..l.k.l..', '....k....', '....kl...', '...lk....', '....k....', '....k....'];
const LANTERN = ['..ooo..', 'ooooooO', '.oOoOo.', '.oyyyo.', '.oyyyo.', 'ooooooO', '..ooO..', '..ooO..', '.oooOO.'];
const HUT = [
  '..............ss....',
  '......ffffffffss....',
  '.....ffffffffffff...',
  '....ffFffffFffffff..',
  '...ffffffffffffffff.',
  '..FFFFFFFFFFFFFFFFFF',
  '....wwwwwwwwwwwwwW..',
  '....wxxxwwwwwddwwW..',
  '....wxxxwwwwwddwwW..',
  '....wwwwwwwwwddwwW..',
  '....WWWWWWWWWWWWWW..',
];
const PINE = ['..NNN..', '.NNNNN.', 'NNnNNnN', '...k...', '..kk...'];
const TUFT = ['g.g', 'gGg'];
const FLOWERS = ['.v..Y.', 'vLv.L.', '.L..L.'];
const STARS = [[8, 6], [19, 15], [34, 4], [46, 12], [61, 3], [73, 9], [88, 5], [99, 14], [112, 4], [127, 10], [141, 6], [6, 26], [138, 22], [52, 22], [96, 24], [120, 30], [28, 34], [146, 36]] as const;
const FIREFLIES = [[30, 52], [58, 40], [90, 48], [118, 44], [74, 30]] as const;
const CLOUD_A = [10, 18] as const;
const CLOUD_B = [60, 30] as const;

const CANOPY = [[48, Y0 - 21, 7.5], [41.5, Y0 - 17, 5.5], [54.5, Y0 - 17.5, 6], [48, Y0 - 15, 6.5], [44, Y0 - 23.5, 4.5], [52, Y0 - 23.5, 4.5]] as const;
const inCanopy = (x: number, y: number) => CANOPY.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r);

function drawCanopy(layer: PixelLayer) {
  for (let y = Y0 - 32; y < Y0 - 6; y++) {
    for (let x = 30; x < 66; x++) {
      if (!inCanopy(x, y)) continue;
      let tone = 'canopy';
      if (!inCanopy(x - 1, y - 1) && y < Y0 - 17) tone = 'canopy-hi';
      if (!inCanopy(x + 1, y + 1) || (!inCanopy(x + 2, y + 2) && hash(x, y) < 0.5) || hash(x, y, 3) < 0.07) tone = 'canopy-2';
      layer.add(x, y, tone);
    }
  }
}

function drawTrunk(layer: PixelLayer) {
  for (let y = Y0 - 12; y < Y0; y++) layer.add(TREE_X - 1, y, 'trunk').add(TREE_X, y, 'trunk-2');
  layer.add(TREE_X - 2, Y0 - 1, 'trunk').add(TREE_X + 1, Y0 - 1, 'trunk-2');
  for (let x = TREE_X + 1; x < TREE_X + 5; x++) layer.add(x, Y0 - 13 - (x > TREE_X + 2 ? 1 : 0), 'trunk');
}

function drawSwing(layer: PixelLayer) {
  for (let y = Y0 - 15; y < Y0 - 5; y++) layer.add(55, y, 'trunk-2').add(60, y, 'trunk-2');
  for (let x = 54; x <= 61; x++) layer.add(x, Y0 - 5, 'trunk');
  for (let x = 55; x <= 60; x++) layer.add(x, Y0 - 4, 'trunk-2');
}

function buildLayers(tier: SceneProps['tier']) {
  const ground = new PixelLayer();
  drawIsland(ground, 75, Y0, 47, 20, 1.3);
  [33, 79, 88, 118].forEach((x) => ground.sprite(TUFT, x, Y0 - 2, L));
  if (tier >= 4) ground.sprite(FLOWERS, 112, Y0 - 3, L).sprite(FLOWERS, 29, Y0 - 3, L);

  const tree = new PixelLayer();
  const canopy = new PixelLayer();
  if (tier === 0) tree.sprite(SPROUT, TREE_X - 2, Y0 - 4, L);
  else if (tier === 1) tree.sprite(SAPLING, TREE_X - 4, Y0 - 10, L);
  else { drawTrunk(tree); drawCanopy(canopy); }

  const swing = new PixelLayer();
  if (tier >= 4) drawSwing(swing);

  const islet = new PixelLayer();
  if (tier >= 5) { drawIsland(islet, 136, 46, 9, 7, 4.2); islet.sprite(PINE, 133, 41, L).sprite(TUFT, 140, 44, L); }

  return {
    ground, tree, canopy, swing, islet,
    lantern: new PixelLayer().sprite(LANTERN, 80, Y0 - 9, L),
    hut: new PixelLayer().sprite(HUT, 92, Y0 - 11, L),
  };
}

export default function IslandScene({ tier, phase }: SceneProps) {
  const skyFxRef = useRef<SVGGElement>(null);
  const groundFxRef = useRef<SVGGElement>(null);
  const canopyRef = useRef<SVGGElement>(null);
  const treeRef = useRef<SVGGElement>(null);
  const swingRef = useRef<SVGGElement>(null);
  const layers = useMemo(() => buildLayers(tier), [tier]);
  const { isLit, toggle } = useLamps(phase);

  const pickStar = useCallback(() => [30 + Math.round(Math.random() * 60), 3 + Math.round(Math.random() * 8)] as const, []);
  useAmbientShootingStars(skyFxRef, phase, pickStar);

  const onTree = () => {
    rustle(canopyRef.current ?? treeRef.current);
    if (tier < 2 || !groundFxRef.current) return;
    const fx = groundFxRef.current;
    const count = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < count; k++) {
      window.setTimeout(() => {
        // Leaves let go from the underside of the crown and settle on the grass.
        fallingLeaf(fx, 40 + Math.round(Math.random() * 16), Y0 - 14 + Math.round(Math.random() * 3), Y0 - 1, Math.random() < 0.4 ? 'fall' : 'leaf');
      }, k * 260 + Math.random() * 120);
    }
  };

  return (
    <>
      <Stars points={STARS} />
      <Sun onClick={() => skyFxRef.current && flock(skyFxRef.current, 0, 150, 13)} />
      <Moon x={18} y={8} onClick={() => skyFxRef.current && shootingStar(skyFxRef.current, ...pickStar())} />
      <Clouds a={CLOUD_A} b={CLOUD_B} />
      <g ref={skyFxRef} />

      {tier >= 5 && <g className="nsc-bob-slow"><Pixels layer={layers.islet} /></g>}

      <g className="nsc-bob">
        <Pixels layer={layers.ground} />
        {tier >= 4 && (
          <g ref={swingRef} className="nsc-swing nsc-hit" onClick={() => swingRef.current && swingPush(swingRef.current)}>
            <Pixels layer={layers.swing} />
          </g>
        )}
        <g ref={treeRef} className="nsc-hit" onClick={onTree}>
          <Pixels layer={layers.tree} />
          <g ref={canopyRef}><Pixels layer={layers.canopy} /></g>
        </g>
        {tier >= 2 && (
          <g className={`nsc-hit nsc-lamp${isLit('lantern') ? ' is-lit' : ''}`} onClick={() => toggle('lantern')}>
            <circle className="nsc-halo" cx={83.5} cy={Y0 - 5.5} r={4.5} />
            <Pixels layer={layers.lantern} />
          </g>
        )}
        {tier >= 3 && (
          <g className={`nsc-hit nsc-lamp${isLit('hut') ? ' is-lit' : ''}`} onClick={() => toggle('hut')}>
            <g className="nsc-smoke">
              {[0, 1, 2].map((k) => <rect key={k} x={106} y={Y0 - 13} width={1} height={1} style={{ fill: 'var(--px-smoke)' }} />)}
            </g>
            <Pixels layer={layers.hut} />
          </g>
        )}
        <Rabbit x={RABBIT_X} y={Y0 - 9} night={phase === 'night'} />
        <g ref={groundFxRef} />
      </g>

      <g className="nsc-flies">
        {FIREFLIES.map(([x, y], k) => (
          <rect key={k} className="nsc-fly" x={x} y={y} width={1} height={1}
            style={{ animationDelay: `${-k * 1.3}s, ${-k * 0.7}s` }} />
        ))}
      </g>
    </>
  );
}
