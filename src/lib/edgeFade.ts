/**
 * The one driver behind every scroll-edge fade in the app: the preview pane and
 * split editor's leading edge, the tab strip's two overflow edges, and the
 * sidebar toolbar's seam.
 *
 * Each of those used to decide for itself whether it was faded — three
 * different booleans flipped at a 1px scroll threshold, two of them with no
 * transition at all. A boolean means a whole band of the surface appears in one
 * frame for a hair of wheel movement, which is the thing that reads as abrupt:
 * an edge is supposed to dissolve as content travels into it, not switch
 * states. So strength here is continuous — distance from the edge, in units of
 * FADE_TRAVEL_PX, clamped to 0→1 — and each surface reads it out of a CSS
 * variable and spends it however suits it (a mask ramp that grows, an overlay
 * that fades up). At 0 every one of them collapses to "no fade", so no surface
 * needs a second "off" rule to keep in sync.
 *
 * Written straight to the DOM node, rAF-coalesced: scrolling must not
 * re-render the note body or the tab strip, and a scroll burst must not queue
 * one repaint per event.
 *
 * Deliberately no ResizeObserver in here. The far edge does move without a
 * scroll event, but the tab strip already learned the hard way which box to
 * observe (see EditorHeader) — so the owner observes what it knows and calls
 * refresh().
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
