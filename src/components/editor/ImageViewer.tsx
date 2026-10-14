import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MAX_SCALE = 8;
// A press that travels less than this is a click (close), not a pan — a shaky hand doesn't count as a drag.
const DRAG_THRESHOLD = 4;
const DOUBLE_CLICK_SCALE = 2;

interface View { scale: number; x: number; y: number }
const FIT: View = { scale: 1, x: 0, y: 0 };

/**
 * Full-screen image view. Wheel or pinch zooms around the pointer rather than the screen centre, a drag past
 * 4px pans once zoomed in, double-click toggles 2× at the pointer, and a click or Escape closes. On touch screens
 * the browser keeps its own pinch-zoom and pan (touch-action is only cut for fine pointers).
 */
export function ImageViewer({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [animate, setAnimate] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Written through on every change, so wheel and pan events between renders build on the latest view.
  const viewRef = useRef(view);
  const commit = (next: View) => {
    viewRef.current = next;
    setView(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keeps a zoomed image from being dragged off screen. The offset may reach whichever is larger: how far the
  // image overhangs the viewport, or how much it has grown — the latter is exactly what zooming about a point
  // inside the image needs, so pointer-anchored zoom is never pulled back to the centre.
  const clamp = (next: View): View => {
    const img = imgRef.current;
    if (!img) return next;
    const w0 = img.offsetWidth;
    const h0 = img.offsetHeight;
    const w = w0 * next.scale;
    const h = h0 * next.scale;
    const maxX = Math.max(0, (w - window.innerWidth) / 2, (w - w0) / 2);
    const maxY = Math.max(0, (h - window.innerHeight) / 2, (h - h0) / 2);
    return { scale: next.scale, x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  };

  // Scales about a screen point: the image pixel under it stays put.
  const zoomAt = (clientX: number, clientY: number, scale: number): View => {
    const current = viewRef.current;
    const next = Math.min(MAX_SCALE, Math.max(1, scale));
    const ratio = next / current.scale;
    const px = clientX - window.innerWidth / 2;
    const py = clientY - window.innerHeight / 2;
    return clamp({ scale: next, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio });
  };

  // Native listener: React's onWheel is passive, so it can't stop the page from zooming on pinch.
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Pinch arrives as ctrl+wheel with small deltas; a mouse wheel notch is ~100. Same curve for both.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      setAnimate(false);
      commit(zoomAt(e.clientX, e.clientY, viewRef.current.scale * factor));
    };
    overlay.addEventListener('wheel', onWheel, { passive: false });
    return () => overlay.removeEventListener('wheel', onWheel);
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const overlay = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    // Pan by the step since the last move, applied to the current view, so a wheel zoom mid-drag isn't undone.
    let lastX = startX;
    let lastY = startY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        moved = true;
        overlay.setPointerCapture(e.pointerId);
        setDragging(true);
        setAnimate(false);
      }
      const current = viewRef.current;
      if (current.scale > 1) commit(clamp({ ...current, x: current.x + ev.clientX - lastX, y: current.y + ev.clientY - lastY }));
      lastX = ev.clientX;
      lastY = ev.clientY;
    };
    const detach = () => {
      overlay.removeEventListener('pointermove', move);
      overlay.removeEventListener('pointerup', up);
      overlay.removeEventListener('pointercancel', cancel);
      setDragging(false);
    };
    // The browser took the pointer (a touch pinch or scroll): never a click, so never a close.
    const cancel = () => detach();
    const up = () => {
      detach();
      // Only a press that never became a drag closes; the click event alone can't tell the two apart.
      // A second press inside the window is a double-click: drop the pending close and let it zoom.
      if (moved) return;
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
        return;
      }
      closeTimer.current = window.setTimeout(() => { closeTimer.current = null; onClose(); }, 220);
    };
    overlay.addEventListener('pointermove', move);
    overlay.addEventListener('pointerup', up);
    overlay.addEventListener('pointercancel', cancel);
  };

  // A single click closes after a beat, so a double-click can cancel it and zoom instead.
  const closeTimer = useRef<number | null>(null);
  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); }, []);
  const handleDoubleClick = (e: React.MouseEvent) => {
    setAnimate(true);
    commit(viewRef.current.scale > 1 ? FIT : zoomAt(e.clientX, e.clientY, DOUBLE_CLICK_SCALE));
  };

  const zoomed = view.scale > 1;
  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-label={alt || 'Image'}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden p-8 select-none pointer-fine:touch-none"
      style={{ background: 'rgba(0,0,0,0.85)', cursor: dragging && zoomed ? 'grabbing' : zoomed ? 'grab' : 'zoom-out' }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="max-h-[95%] max-w-[95%] object-contain"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transition: animate ? 'transform var(--dur-base) var(--ease-out)' : 'none',
        }}
      />
    </div>,
    document.body
  );
}
