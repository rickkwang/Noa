import { useCallback, useRef } from 'react';
import { attachEdgeFade, type EdgeFadeOptions } from '../lib/edgeFade';

/**
 * Edge fade on a vertical scroller whose far edge can move without a scroll event: content growing or
 * shrinking changes how far there is left to scroll. Observes the scroller and its children to refresh.
 */
export function attachObservedEdgeFade(scroller: HTMLElement, options: EdgeFadeOptions = {}): () => void {
  const fade = attachEdgeFade(scroller, { ...options, end: true });
  const resize = new ResizeObserver(() => fade.refresh());
  const observe = () => {
    resize.disconnect();
    resize.observe(scroller);
    for (const child of scroller.children) resize.observe(child);
  };
  observe();
  const children = new MutationObserver(observe);
  children.observe(scroller, { childList: true });
  return () => {
    children.disconnect();
    resize.disconnect();
    fade.dispose();
  };
}

/** Callback ref for a scroller styled with `.noa-edge-fade-y`; survives the element being swapped between renders. */
export function useEdgeFadeRef<T extends HTMLElement>() {
  const cleanupRef = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanupRef.current?.();
    // Reaches full strength over the 28px ramp length of .noa-edge-fade-y.
    cleanupRef.current = el ? attachObservedEdgeFade(el, { travel: 28 }) : null;
  }, []);
}
