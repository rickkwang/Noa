import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachEdgeFade, FADE_TRAVEL_PX } from '../../src/lib/edgeFade';

/* The driver behind every scroll-edge fade in the app. It runs on nothing but
   a scroller's numbers and an element's style, so it is exercised here against
   fakes rather than a DOM — what matters is the contract the CSS depends on:
   0 at rest (which is what makes "no fade until scrolled" free, with no second
   rule anywhere), 1 past the travel distance, and one write per frame however
   many scroll events arrive. */

type FakeStyle = {
  setProperty: (name: string, value: string) => void;
  removeProperty: (name: string) => void;
  props: Record<string, string>;
};

const fakeStyle = (): FakeStyle => {
  const props: Record<string, string> = {};
  return {
    props,
    setProperty: (name, value) => { props[name] = value; },
    removeProperty: (name) => { delete props[name]; },
  };
};

const fakeScroller = (metrics: Partial<Record<'scrollTop' | 'scrollLeft' | 'scrollHeight' | 'clientHeight' | 'scrollWidth' | 'clientWidth', number>> = {}) => {
  const listeners = new Set<() => void>();
  const el = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    scrollWidth: 1000,
    clientWidth: 500,
    ...metrics,
    style: fakeStyle(),
    addEventListener: (_type: string, fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_type: string, fn: () => void) => { listeners.delete(fn); },
  };
  return { el, fire: () => listeners.forEach(fn => fn()), listenerCount: () => listeners.size };
};

let frames: Array<() => void> = [];
let nextFrameId = 1;
const flush = () => { const queued = frames; frames = []; queued.forEach(fn => fn()); };

beforeEach(() => {
  frames = [];
  nextFrameId = 1;
  globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => {
    frames.push(() => fn(0));
    return nextFrameId++;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => { frames = []; }) as typeof globalThis.cancelAnimationFrame;
});

afterEach(() => { frames = []; });

describe('attachEdgeFade', () => {
  it('writes 0 at rest, so an unscrolled surface needs no separate rule', () => {
    const { el } = fakeScroller();
    attachEdgeFade(el as unknown as HTMLElement);
    expect(el.style.props['--noa-fade-top']).toBe('0.000');
  });

  it('ramps to 1 across the travel distance and clamps beyond it', () => {
    const { el, fire } = fakeScroller();
    attachEdgeFade(el as unknown as HTMLElement);

    el.scrollTop = FADE_TRAVEL_PX / 2;
    fire(); flush();
    expect(el.style.props['--noa-fade-top']).toBe('0.500');

    el.scrollTop = FADE_TRAVEL_PX * 4;
    fire(); flush();
    expect(el.style.props['--noa-fade-top']).toBe('1.000');
  });

  it('clamps the rubber-band overscroll that macOS reports as a negative offset', () => {
    const { el, fire } = fakeScroller();
    attachEdgeFade(el as unknown as HTMLElement);
    el.scrollTop = -40;
    fire(); flush();
    expect(el.style.props['--noa-fade-top']).toBe('0.000');
  });

  it('coalesces a scroll burst into one write', () => {
    const { el, fire } = fakeScroller();
    attachEdgeFade(el as unknown as HTMLElement);
    el.scrollTop = 32;

    fire(); fire(); fire();
    expect(frames).toHaveLength(1);
    flush();
    expect(el.style.props['--noa-fade-top']).toBe('0.500');
  });

  it('tracks both edges on the horizontal axis, easing the far one out at the end', () => {
    const { el, fire } = fakeScroller({ scrollWidth: 1000, clientWidth: 500 });
    attachEdgeFade(el as unknown as HTMLElement, { axis: 'x', end: true });
    expect(el.style.props['--noa-fade-left']).toBe('0.000');
    expect(el.style.props['--noa-fade-right']).toBe('1.000');

    el.scrollLeft = 500 - FADE_TRAVEL_PX / 2;
    fire(); flush();
    expect(el.style.props['--noa-fade-left']).toBe('1.000');
    expect(el.style.props['--noa-fade-right']).toBe('0.500');
  });

  it('reports no far-edge fade when there is nothing to scroll', () => {
    const { el } = fakeScroller({ scrollWidth: 500, clientWidth: 500 });
    attachEdgeFade(el as unknown as HTMLElement, { axis: 'x', end: true });
    expect(el.style.props['--noa-fade-right']).toBe('0.000');
  });

  it('writes to a target that is not the scroller, for overlays on a sibling', () => {
    const { el } = fakeScroller();
    const target = { style: fakeStyle() };
    el.scrollTop = FADE_TRAVEL_PX;
    attachEdgeFade(el as unknown as HTMLElement, { target: target as unknown as HTMLElement });
    expect(target.style.props['--noa-fade-top']).toBe('1.000');
    expect(el.style.props['--noa-fade-top']).toBeUndefined();
  });

  it('drops the listener and the variables on dispose', () => {
    const { el, listenerCount } = fakeScroller();
    const fade = attachEdgeFade(el as unknown as HTMLElement, { axis: 'x', end: true });
    fade.dispose();
    expect(listenerCount()).toBe(0);
    expect(el.style.props['--noa-fade-left']).toBeUndefined();
    expect(el.style.props['--noa-fade-right']).toBeUndefined();
  });

  it('re-measures on refresh, for layout changes no scroll event reports', () => {
    const { el } = fakeScroller({ scrollWidth: 500, clientWidth: 500 });
    const fade = attachEdgeFade(el as unknown as HTMLElement, { axis: 'x', end: true });
    expect(el.style.props['--noa-fade-right']).toBe('0.000');

    el.scrollWidth = 1000;
    fade.refresh();
    flush();
    expect(el.style.props['--noa-fade-right']).toBe('1.000');
  });
});

describe('the surfaces that consume it', () => {
  const cssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));

  it('keeps every ramp on the same sampled smoothstep', async () => {
    const css = await readFile(cssPath, 'utf8');
    // The curve, not the lengths: a linear ramp reads as two hard edges, and
    // these alphas are what make it dissolve instead.
    for (const alpha of ['0.04', '0.16', '0.32', '0.5', '0.68', '0.84', '0.96']) {
      expect(css).toContain(`rgb(0 0 0 / ${alpha}) calc(var(--noa-fade-top, 0)`);
      expect(css).toContain(`rgb(0 0 0 / ${alpha}) calc(var(--noa-fade-left, 0)`);
    }
    // The sidebar seam spends the same strength as opacity rather than height,
    // but must still be gated on the tree having scrolled.
    expect(css).toContain('opacity: var(--noa-fade-top, 0);');
  });
});
