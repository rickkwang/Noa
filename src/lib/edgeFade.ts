/**
 * Shared driver for every scroll-edge fade (preview/editor leading edge, tab
 * strip overflow, sidebar toolbar seam). Strength is continuous — distance from
 * the edge in units of FADE_TRAVEL_PX, clamped 0→1 — so an edge dissolves as
 * content moves in rather than switching in one frame. Surfaces read it from a
 * CSS variable; at 0 every surface shows "no fade".
 *
 * Written straight to the DOM, rAF-coalesced so scrolling never re-renders React.
 * No ResizeObserver here: owners observe the box they know about (see
 * EditorHeader) and call refresh().
 */
export const FADE_TRAVEL_PX = 64;

export type FadeAxis = 'x' | 'y';

export interface EdgeFadeOptions {
  /** Which way the surface scrolls. Defaults to vertical. */
  axis?: FadeAxis;
  /** Track the far edge (bottom / right) as well as the near one. */
  end?: boolean;
  /** Where the variables land. Defaults to the scroller; pass an ancestor when
   *  the faded element is not the scrolling one. */
  target?: HTMLElement;
}

export interface EdgeFadeHandle {
  /** Re-measure after a layout change no scroll event will report. */
  refresh: () => void;
  dispose: () => void;
}

const FADE_VARS = {
  y: { start: '--noa-fade-top', end: '--noa-fade-bottom' },
  x: { start: '--noa-fade-left', end: '--noa-fade-right' },
} as const;

const clamp01 = (value: number) => (value < 0 || Number.isNaN(value) ? 0 : value > 1 ? 1 : value);

export function attachEdgeFade(
  scroller: HTMLElement,
  options: EdgeFadeOptions = {}
): EdgeFadeHandle {
  const { axis = 'y', end = false, target = scroller } = options;
  const vars = FADE_VARS[axis];
  let frame = 0;

  const apply = () => {
    frame = 0;
    const position = axis === 'y' ? scroller.scrollTop : scroller.scrollLeft;
    const travel =
      axis === 'y'
        ? scroller.scrollHeight - scroller.clientHeight
        : scroller.scrollWidth - scroller.clientWidth;
    target.style.setProperty(vars.start, clamp01(position / FADE_TRAVEL_PX).toFixed(3));
    if (end) {
      target.style.setProperty(vars.end, clamp01((travel - position) / FADE_TRAVEL_PX).toFixed(3));
    }
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(apply);
  };

  apply();
  scroller.addEventListener('scroll', schedule, { passive: true });

  return {
    refresh: schedule,
    dispose: () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      target.style.removeProperty(vars.start);
      if (end) target.style.removeProperty(vars.end);
    },
  };
}
