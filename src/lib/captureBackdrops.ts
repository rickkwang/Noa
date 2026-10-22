// Built-in backdrops for the window-capture margin, drawn procedurally so no image assets ship.
// Each is a base fill under a few large soft glows, plus faint grain to keep the gradients from banding.

export type CaptureBackdropId = 'clay' | 'sand' | 'sage' | 'dusk' | 'ocean' | 'graphite';

interface Glow {
  /** Centre and radius as fractions of the canvas (radius of the longer edge). */
  x: number;
  y: number;
  r: number;
  color: string;
}

interface BackdropSpec {
  id: CaptureBackdropId;
  label: string;
  base: string;
  glows: Glow[];
}

export const CAPTURE_BACKDROPS: BackdropSpec[] = [
  {
    id: 'clay',
    label: 'Clay',
    base: '#E7C2AB',
    glows: [
      { x: 0.12, y: 0.18, r: 0.62, color: '#CC7D5E' },
      { x: 0.88, y: 0.12, r: 0.55, color: '#F4DCC8' },
      { x: 0.78, y: 0.92, r: 0.6, color: '#B5654A' },
      { x: 0.3, y: 0.9, r: 0.45, color: '#F6E5D4' },
    ],
  },
  {
    id: 'sand',
    label: 'Sand',
    base: '#ECE2D0',
    glows: [
      { x: 0.18, y: 0.15, r: 0.6, color: '#F9F3E7' },
      { x: 0.85, y: 0.85, r: 0.6, color: '#D6C19E' },
      { x: 0.75, y: 0.2, r: 0.4, color: '#E9D6B6' },
    ],
  },
  {
    id: 'sage',
    label: 'Sage',
    base: '#C6D1BF',
    glows: [
      { x: 0.15, y: 0.85, r: 0.62, color: '#8AA087' },
      { x: 0.82, y: 0.15, r: 0.6, color: '#E6EBDD' },
      { x: 0.92, y: 0.88, r: 0.48, color: '#A3B59B' },
      { x: 0.1, y: 0.1, r: 0.38, color: '#DDE4D1' },
    ],
  },
  {
    id: 'dusk',
    label: 'Dusk',
    base: '#6B679B',
    glows: [
      { x: 0.1, y: 0.1, r: 0.65, color: '#3B3970' },
      { x: 0.88, y: 0.88, r: 0.6, color: '#E5A19F' },
      { x: 0.6, y: 0.28, r: 0.48, color: '#B28AB6' },
      { x: 0.28, y: 0.95, r: 0.42, color: '#F0C4A6' },
    ],
  },
  {
    id: 'ocean',
    label: 'Ocean',
    base: '#2B5A78',
    glows: [
      { x: 0.82, y: 0.18, r: 0.6, color: '#6DB1C2' },
      { x: 0.12, y: 0.88, r: 0.7, color: '#163652' },
      { x: 0.42, y: 0.4, r: 0.48, color: '#3D8CA0' },
      { x: 0.95, y: 0.92, r: 0.35, color: '#A6D6DA' },
    ],
  },
  {
    id: 'graphite',
    label: 'Graphite',
    base: '#2A2C31',
    glows: [
      { x: 0.18, y: 0.12, r: 0.6, color: '#4A4E57' },
      { x: 0.85, y: 0.92, r: 0.7, color: '#16171A' },
      { x: 0.82, y: 0.18, r: 0.42, color: '#5A4943' },
    ],
  },
];

const SIZES = {
  full: { width: 2400, height: 1500 },
  swatch: { width: 120, height: 75 },
} as const;
const GRAIN_TILE = 160;
const GRAIN_ALPHA = 10;

export function isCaptureBackdropId(value: unknown): value is CaptureBackdropId {
  return CAPTURE_BACKDROPS.some(spec => spec.id === value);
}

function transparent(hex: string) {
  return `${hex}00`;
}

// Seeded so the grain is identical between the preview and the export.
function grainTile() {
  const tile = document.createElement('canvas');
  tile.width = GRAIN_TILE;
  tile.height = GRAIN_TILE;
  const ctx = tile.getContext('2d');
  if (!ctx) return null;
  const pixels = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const shade = seed >>> 31 ? 255 : 0;
    pixels.data[i] = shade;
    pixels.data[i + 1] = shade;
    pixels.data[i + 2] = shade;
    pixels.data[i + 3] = GRAIN_ALPHA;
  }
  ctx.putImageData(pixels, 0, 0);
  return tile;
}

function renderBackdrop(spec: BackdropSpec, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const extent = Math.max(width, height);
  ctx.fillStyle = spec.base;
  ctx.fillRect(0, 0, width, height);
  for (const glow of spec.glows) {
    const x = glow.x * width;
    const y = glow.y * height;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glow.r * extent);
    gradient.addColorStop(0, glow.color);
    gradient.addColorStop(1, transparent(glow.color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  const tile = grainTile();
  const pattern = tile && ctx.createPattern(tile, 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

function render(id: CaptureBackdropId, size: keyof typeof SIZES) {
  const spec = CAPTURE_BACKDROPS.find(candidate => candidate.id === id);
  return spec ? renderBackdrop(spec, SIZES[size].width, SIZES[size].height) : null;
}

// Only the compressed URLs are kept: a full-size canvas is ~14MB, and holding one per backdrop for the session
// would pin ~90MB after a user has tried them all.
const urlCache = new Map<string, string>();

/**
 * For the preview and the swatches, rendered once per session and size. The swatch size keeps the picker
 * from rendering every backdrop at full size on open.
 */
export function getCaptureBackdropUrl(id: CaptureBackdropId, size: keyof typeof SIZES = 'full') {
  const key = `${id}:${size}`;
  const cached = urlCache.get(key);
  if (cached) return cached;
  const url = render(id, size)?.toDataURL('image/jpeg', 0.92) ?? null;
  if (url) urlCache.set(key, url);
  return url;
}

/** A fresh full-size canvas for one export, left for the caller to drop. */
export function renderCaptureBackdrop(id: CaptureBackdropId) {
  return render(id, 'full');
}

/** Scales the backdrop to cover the target, centred, like CSS `background-size: cover`. */
export function drawBackdropCover(ctx: CanvasRenderingContext2D, backdrop: HTMLCanvasElement, width: number, height: number) {
  const scale = Math.max(width / backdrop.width, height / backdrop.height);
  const drawWidth = backdrop.width * scale;
  const drawHeight = backdrop.height * scale;
  ctx.drawImage(backdrop, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}
