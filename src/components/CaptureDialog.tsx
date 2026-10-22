import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import type { WindowShot } from '../hooks/useWindowCapture';
import { CAPTURE_BACKDROPS, drawBackdropCover, getCaptureBackdropUrl, isCaptureBackdropId, renderCaptureBackdrop, type CaptureBackdropId } from '../lib/captureBackdrops';
import { Copy, Download, RefreshCcw, RotateCcw, X, ZoomIn, ZoomOut } from '../lib/icons';
import { lsGetJson, lsSetJson } from '../lib/safeLocalStorage';
import SettingsToggle from './settings/SettingsToggle';

/** Fractions of the image size, so the preview's display scale doesn't matter. */
interface BlurRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CaptureDialogProps {
  shot: WindowShot;
  onRetake: () => void;
  onCopy: (dataUrl: string) => Promise<void>;
  onSave: (dataUrl: string) => Promise<void>;
  /** The image couldn't be composed (decode or canvas failure); the copy/save never ran. */
  onRenderFailed: () => void;
  onClose: () => void;
}

// Blur cell in CSS pixels. Big enough that even a heading spans only a couple of cells.
const BLUR_CELL_PX = 16;
// Drags smaller than this (as a fraction of the image) are treated as stray clicks.
const MIN_RECT = 0.006;
const MUTED = 'text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_55%,transparent)]';
const SECTION_LABEL = `mb-2 px-1 text-xs font-medium ${MUTED}`;
const CARD = 'rounded-xl bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_4%,transparent)] py-1';
const ROW_LABEL = 'text-[13px] leading-5 text-[var(--text-primary,#2D2D2B)]';
const ICON_BUTTON = 'flex size-7 shrink-0 items-center justify-center rounded-md text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_60%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_6%,transparent)] transition-colors disabled:opacity-35 disabled:hover:bg-transparent';
const GHOST_BUTTON = 'flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_70%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_6%,transparent)] transition-colors disabled:opacity-50';
const OUTLINE_BUTTON = 'flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-strong,rgba(11,11,11,0.20))] bg-[var(--bg-primary,#FCFCFB)] px-3 text-[13px] text-[var(--text-primary,#2D2D2B)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,var(--bg-primary,#FCFCFB))] transition-colors disabled:opacity-50';

// Preview zoom, relative to fitting the whole screenshot in the preview (1 = fit). Export is unaffected.
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
const FIT_PADDING_PX = 16;
// Margin added around the window on export, in CSS pixels of the captured window.
const MAX_MARGIN = 160;
const MARGIN_STEP = 8;
const WINDOW_RADIUS_PX = 10;
const DEFAULT_PLAIN_BACKDROP = '#EFEAE3';
// Picking a backdrop while the margin is 0 would change nothing visible, so it opens the margin to this.
const MARGIN_ON_BACKDROP_PICK = 64;

/** 'plain' is the app's own secondary surface, so it follows the current theme. */
type BackdropChoice = 'plain' | CaptureBackdropId;

interface CapturePrefs {
  margin: number;
  backdrop: BackdropChoice;
}

function loadPrefs(): CapturePrefs {
  const stored = lsGetJson<Partial<CapturePrefs>>(STORAGE_KEYS.CAPTURE_PREFS);
  const margin = typeof stored?.margin === 'number' && Number.isFinite(stored.margin)
    ? Math.min(MAX_MARGIN, Math.max(0, Math.round(stored.margin / MARGIN_STEP) * MARGIN_STEP))
    : 0;
  const backdrop = isCaptureBackdropId(stored?.backdrop) ? stored.backdrop : 'plain';
  return { margin, backdrop };
}

interface Frame {
  margin: number;
  /** A colour, or a rendered backdrop drawn to cover the framed image. */
  backdrop: string | HTMLCanvasElement;
}

/** Shadow falls off inside the margin: a fixed blur would be hard-clipped at small margins. */
function frameShadow(margin: number) {
  return { blur: Math.min(56, margin * 0.7), offsetY: Math.min(20, margin * 0.25) };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the screenshot'));
    image.src = src;
  });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

// Blurred areas: downsample then smooth back up. Reads as a blur, and the low-res pass drops the glyph detail.
async function renderShot(src: string, rects: BlurRect[], scale: number, frame: Frame) {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(image, 0, 0);
  const cell = Math.max(6, Math.round(BLUR_CELL_PX * scale));
  for (const rect of rects) {
    const x = Math.round(rect.x * canvas.width);
    const y = Math.round(rect.y * canvas.height);
    const width = Math.max(1, Math.round(rect.width * canvas.width));
    const height = Math.max(1, Math.round(rect.height * canvas.height));
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(width / cell));
    small.height = Math.max(1, Math.round(height / cell));
    const smallCtx = small.getContext('2d');
    if (!smallCtx) continue;
    smallCtx.imageSmoothingQuality = 'high';
    smallCtx.drawImage(canvas, x, y, width, height, 0, 0, small.width, small.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, small.width, small.height, x, y, width, height);
  }
  if (frame.margin <= 0) return canvas.toDataURL('image/png');

  const margin = Math.round(frame.margin * scale);
  const radius = WINDOW_RADIUS_PX * scale;
  const shadow = frameShadow(frame.margin);
  const framed = document.createElement('canvas');
  framed.width = canvas.width + margin * 2;
  framed.height = canvas.height + margin * 2;
  const frameCtx = framed.getContext('2d');
  if (!frameCtx) throw new Error('Canvas unavailable');
  if (typeof frame.backdrop === 'string') {
    frameCtx.fillStyle = frame.backdrop;
    frameCtx.fillRect(0, 0, framed.width, framed.height);
  } else {
    drawBackdropCover(frameCtx, frame.backdrop, framed.width, framed.height);
  }
  frameCtx.save();
  frameCtx.shadowColor = 'rgba(15, 18, 26, 0.28)';
  frameCtx.shadowBlur = shadow.blur * scale;
  frameCtx.shadowOffsetY = shadow.offsetY * scale;
  // Only casts the shadow; the window image is drawn over it.
  frameCtx.fillStyle = '#FFFFFF';
  roundedRect(frameCtx, margin, margin, canvas.width, canvas.height, radius);
  frameCtx.fill();
  frameCtx.restore();
  roundedRect(frameCtx, margin, margin, canvas.width, canvas.height, radius);
  frameCtx.clip();
  frameCtx.drawImage(canvas, margin, margin);
  return framed.toDataURL('image/png');
}

// Buttons step through ZOOM_LEVELS; after a pinch leaves an in-between value, they snap to the next level.
function stepZoom(current: number, direction: 1 | -1) {
  const epsilon = 0.001;
  return direction > 0
    ? ZOOM_LEVELS.find(level => level > current + epsilon) ?? MAX_ZOOM
    : [...ZOOM_LEVELS].reverse().find(level => level < current - epsilon) ?? MIN_ZOOM;
}

function normalize(a: { x: number; y: number }, b: { x: number; y: number }): BlurRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export default function CaptureDialog({ shot, onRetake, onCopy, onSave, onRenderFailed, onClose }: CaptureDialogProps) {
  const [hideNames, setHideNames] = useState(true);
  const [rects, setRects] = useState<BlurRect[]>([]);
  const [draft, setDraft] = useState<BlurRect | null>(null);
  const [busy, setBusy] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const pressStartedOnBackdropRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [prefs, setPrefs] = useState(loadPrefs);
  const { margin, backdrop } = prefs;
  const [plainColor] = useState(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || DEFAULT_PLAIN_BACKDROP);
  const backdropUrl = backdrop === 'plain' ? null : getCaptureBackdropUrl(backdrop);

  useEffect(() => {
    lsSetJson(STORAGE_KEYS.CAPTURE_PREFS, prefs);
  }, [prefs]);

  const setMargin = (next: number) => setPrefs(current => ({ ...current, margin: next }));
  const pickBackdrop = (next: BackdropChoice) => setPrefs(current => ({
    backdrop: next,
    margin: current.margin === 0 ? MARGIN_ON_BACKDROP_PICK : current.margin,
  }));
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageWrapRef = useRef<HTMLDivElement>(null);
  // Image point that should stay under the given viewport point once the new zoom has laid out.
  const zoomAnchorRef = useRef<{ fx: number; fy: number; vx: number; vy: number } | null>(null);
  const { dialogRef, onKeyDown } = useDialogKeyboard(onClose);
  const src = hideNames ? shot.redacted : shot.plain;

  // The preview fits the framed image, so the margin is shown at its exported proportion.
  const marginImagePx = margin * shot.scale;
  const fitScale = natural && viewport
    ? Math.min(
      (viewport.width - FIT_PADDING_PX * 2) / (natural.width + marginImagePx * 2),
      (viewport.height - FIT_PADDING_PX * 2) / (natural.height + marginImagePx * 2),
    )
    : 0;
  const displayWidth = natural ? natural.width * fitScale * zoom : 0;
  const displayHeight = natural ? natural.height * fitScale * zoom : 0;
  const displayMargin = marginImagePx * fitScale * zoom;
  const displayShadow = frameShadow(margin);
  const displayUnit = fitScale * zoom * shot.scale;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const zoomTo = (next: number, clientX?: number, clientY?: number) => {
    const element = viewportRef.current;
    const wrap = imageWrapRef.current;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (element && wrap) {
      const view = element.getBoundingClientRect();
      const image = wrap.getBoundingClientRect();
      const x = clientX ?? view.left + view.width / 2;
      const y = clientY ?? view.top + view.height / 2;
      zoomAnchorRef.current = {
        fx: Math.min(1, Math.max(0, (x - image.left) / image.width)),
        fy: Math.min(1, Math.max(0, (y - image.top) / image.height)),
        vx: x - view.left,
        vy: y - view.top,
      };
    }
    setZoom(clamped);
  };

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const element = viewportRef.current;
    const wrap = imageWrapRef.current;
    zoomAnchorRef.current = null;
    if (!anchor || !element || !wrap) return;
    const view = element.getBoundingClientRect();
    const image = wrap.getBoundingClientRect();
    element.scrollLeft += image.left - view.left + anchor.fx * image.width - anchor.vx;
    element.scrollTop += image.top - view.top + anchor.fy * image.height - anchor.vy;
  }, [zoom]);

  // Trackpad pinch arrives as ctrl+wheel. Registered natively: React's wheel listener is passive.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * Math.exp(-event.deltaY * 0.01)));
        const view = element.getBoundingClientRect();
        const image = imageWrapRef.current?.getBoundingClientRect();
        if (image) {
          zoomAnchorRef.current = {
            fx: Math.min(1, Math.max(0, (event.clientX - image.left) / image.width)),
            fy: Math.min(1, Math.max(0, (event.clientY - image.top) / image.height)),
            vx: event.clientX - view.left,
            vy: event.clientY - view.top,
          };
        }
        return next;
      });
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  const pointFrom = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = pointFrom(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    setDraft(normalize(dragStartRef.current, pointFrom(event)));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setDraft(null);
    if (!start) return;
    const rect = normalize(start, pointFrom(event));
    if (rect.width >= MIN_RECT && rect.height >= MIN_RECT) setRects(current => [...current, rect]);
  };

  const undo = () => setRects(current => current.slice(0, -1));

  // Handled here so they never reach the app's global Cmd+S or the Edit menu's Cmd+C.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
    const key = event.key.toLowerCase();
    const action = !mod ? null
      : key === 'z' ? undo
      : key === 'c' ? () => { void finish(onCopy); }
      : key === 's' ? () => { void finish(onSave); }
      : null;
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      action();
      return;
    }
    onKeyDown(event);
  };

  const finish = async (action: (dataUrl: string) => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      const backdropCanvas = backdrop === 'plain' || margin === 0 ? null : renderCaptureBackdrop(backdrop);
      await action(await renderShot(src, rects, shot.scale, { margin, backdrop: backdropCanvas ?? plainColor }));
    } catch {
      onRenderFailed();
    } finally {
      setBusy(false);
    }
  };

  const exportWidth = natural ? Math.round(natural.width + marginImagePx * 2) : 0;
  const exportHeight = natural ? Math.round(natural.height + marginImagePx * 2) : 0;
  const choices: BackdropChoice[] = ['plain', ...CAPTURE_BACKDROPS.map(spec => spec.id)];

  return (
    // Same scrim as SettingsModal. A drag released over the scrim clicks it, so the press must start there too.
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center backdrop-blur-[4px] bg-[rgba(0,0,0,0.4)] px-4"
      onMouseDown={(e) => { pressStartedOnBackdropRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (pressStartedOnBackdropRef.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Capture window"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="outline-none flex w-full max-w-[1120px] flex-col bg-[var(--surface-page,#F9F9F7)] noa-floating-panel slide-down rounded-dialog overflow-hidden font-ui"
      >
        <header className="flex h-12 shrink-0 items-center gap-2 pl-5 pr-3">
          <h2 className="text-[14px] font-medium text-[var(--text-primary,#2D2D2B)]">Capture window</h2>
          {exportWidth > 0 && (
            <span className={`text-xs tabular-nums ${MUTED}`}>{exportWidth} × {exportHeight}</span>
          )}
          <div className="flex-1" />
          <button aria-label="Close" title="Close" onClick={onClose} className={ICON_BUTTON}>
            <X size={15} />
          </button>
        </header>

        <div className="flex min-h-0">
          <div className="relative min-w-0 flex-1 pb-3 pl-3">
            <div ref={viewportRef} className="h-[64vh] overflow-auto rounded-xl bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_4%,transparent)]">
              <div className="flex h-max min-h-full w-max min-w-full items-center justify-center" style={{ padding: FIT_PADDING_PX }}>
                <div className="shrink-0" style={{
                  padding: displayMargin,
                  background: margin === 0 ? undefined : backdropUrl ? `center / cover url(${backdropUrl})` : plainColor,
                  visibility: fitScale > 0 ? 'visible' : 'hidden',
                }}>
                  <div ref={imageWrapRef} className="relative select-none" style={{ width: displayWidth, height: displayHeight }}>
                    <img
                      src={src}
                      alt="Window screenshot preview"
                      draggable={false}
                      onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                      className="block h-full w-full"
                      style={margin > 0 ? {
                        borderRadius: WINDOW_RADIUS_PX * displayUnit,
                        boxShadow: `0 ${displayShadow.offsetY * displayUnit}px ${displayShadow.blur * displayUnit}px rgba(15, 18, 26, 0.28)`,
                      } : { boxShadow: '0 1px 3px rgba(11, 11, 11, 0.08)' }}
                    />
                    <div
                      className="absolute inset-0 cursor-crosshair touch-none"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={() => { dragStartRef.current = null; setDraft(null); }}
                    >
                      {[...rects, ...(draft ? [draft] : [])].map((rect, index) => (
                        <div
                          key={index}
                          className={`absolute ${rect === draft ? 'border border-dashed border-[var(--accent-color,#CC7D5E)]' : ''}`}
                          style={{
                            left: `${rect.x * 100}%`,
                            top: `${rect.y * 100}%`,
                            width: `${rect.width * 100}%`,
                            height: `${rect.height * 100}%`,
                            backdropFilter: 'blur(10px)',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Floats over the preview so the image keeps the full height. */}
            <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-[var(--divider-subtle)] bg-[color-mix(in_srgb,var(--surface-page,#F9F9F7)_88%,transparent)] p-1 shadow-[0_4px_16px_rgba(11,11,11,0.10)] backdrop-blur-md">
              <button aria-label="Zoom out" title="Zoom out" onClick={() => zoomTo(stepZoom(zoom, -1))} disabled={zoom <= MIN_ZOOM} className={`${ICON_BUTTON} rounded-full`}>
                <ZoomOut size={15} />
              </button>
              <button
                onClick={() => setZoom(1)}
                disabled={zoom === 1}
                title="Fit to view"
                className="h-7 min-w-[52px] rounded-full px-2 text-xs tabular-nums text-[var(--text-primary,#2D2D2B)] transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_6%,transparent)] disabled:hover:bg-transparent"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button aria-label="Zoom in" title="Zoom in" onClick={() => zoomTo(stepZoom(zoom, 1))} disabled={zoom >= MAX_ZOOM} className={`${ICON_BUTTON} rounded-full`}>
                <ZoomIn size={15} />
              </button>
            </div>
          </div>

          <aside className="w-[272px] shrink-0 space-y-5 overflow-y-auto px-4 pb-3">
            <section>
              <h3 className={SECTION_LABEL}>Privacy</h3>
              <div className={CARD}>
                <div className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className={ROW_LABEL}>Hide names</div>
                    <div className={`mt-0.5 text-xs leading-[17px] ${MUTED}`}>Note, folder and tag names in the sidebar and tabs.</div>
                  </div>
                  <SettingsToggle checked={hideNames} onChange={setHideNames} label="Hide names" />
                </div>
                <div className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className={ROW_LABEL}>Blur an area</div>
                    <div className={`mt-0.5 text-xs leading-[17px] ${MUTED}`}>
                      {rects.length > 0 ? `${rects.length} area${rects.length === 1 ? '' : 's'} blurred.` : 'Drag on the screenshot.'}
                    </div>
                  </div>
                  <button aria-label="Undo last blur" title="Undo (⌘Z)" onClick={undo} disabled={rects.length === 0} className={ICON_BUTTON}>
                    <RotateCcw size={15} />
                  </button>
                </div>
              </div>
            </section>

            <section>
              <h3 className={SECTION_LABEL}>Frame</h3>
              <div className={CARD}>
                <div className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="capture-margin" className={ROW_LABEL}>Margin</label>
                    <span className={`text-xs tabular-nums ${MUTED}`}>{margin}px</span>
                  </div>
                  <input
                    id="capture-margin"
                    type="range"
                    min={0}
                    max={MAX_MARGIN}
                    step={MARGIN_STEP}
                    value={margin}
                    onChange={(e) => setMargin(Number(e.target.value))}
                    className="noa-range mt-3 mb-1 w-full"
                    style={{ '--noa-range-fill': `${(margin / MAX_MARGIN) * 100}%` } as CSSProperties}
                  />
                </div>
                <div className="px-3 py-2.5">
                  <div className={ROW_LABEL}>Background</div>
                  <div role="radiogroup" aria-label="Background" className="mt-2.5 mb-0.5 flex justify-between">
                    {choices.map((choice) => {
                      const label = choice === 'plain' ? 'Plain' : CAPTURE_BACKDROPS.find(spec => spec.id === choice)?.label ?? choice;
                      const swatch = choice === 'plain' ? null : getCaptureBackdropUrl(choice, 'swatch');
                      const selected = backdrop === choice;
                      return (
                        <button
                          key={choice}
                          role="radio"
                          aria-checked={selected}
                          aria-label={label}
                          title={label}
                          onClick={() => pickBackdrop(choice)}
                          className="size-6 rounded-full border border-[var(--divider-subtle)] transition-shadow noa-press"
                          style={{
                            background: swatch ? `center / cover url(${swatch})` : plainColor,
                            boxShadow: selected ? '0 0 0 2px var(--bg-primary, #FCFCFB), 0 0 0 3.5px var(--accent-color, #CC7D5E)' : undefined,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          </aside>
        </div>

        <footer className="flex h-14 shrink-0 items-center gap-2 px-4">
          <button onClick={onRetake} disabled={busy} className={GHOST_BUTTON}>
            <RefreshCcw size={14} />
            Retake
          </button>
          <div className="flex-1" />
          <button onClick={() => { void finish(onSave); }} disabled={busy} title="Save (⌘S)" className={OUTLINE_BUTTON}>
            <Download size={14} />
            Save…
          </button>
          {/* Token pair, not literals: bg-[#2D2D2B] is not remapped in dark mode and would vanish into the dark surface. */}
          <button
            onClick={() => { void finish(onCopy); }}
            disabled={busy}
            title="Copy (⌘C)"
            className="flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium bg-[var(--text-primary,#2D2D2B)] text-[var(--bg-primary,#FCFCFB)] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Copy size={14} />
            Copy
          </button>
        </footer>
      </div>
    </div>
  );
}
