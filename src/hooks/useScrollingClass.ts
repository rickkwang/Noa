import { useEffect, useRef } from 'react';

const HIDE_DELAY = 1200;
const FADEOUT_DURATION = 1400;

export function useScrollingClass(
  ref: React.RefObject<HTMLElement | null>,
  options: { capture?: boolean; filterClass?: string } = {}
) {
  const { capture = false, filterClass } = options;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (filterClass && !target.classList.contains(filterClass)) return;
      const scrollingEl = filterClass ? target : el;

      // Cancel any pending fade-out
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      scrollingEl.classList.remove('is-scrolling-out');
      scrollingEl.classList.add('is-scrolling');

      // After idle delay, swap to fade-out animation class
      hideTimerRef.current = setTimeout(() => {
        scrollingEl.classList.remove('is-scrolling');
        scrollingEl.classList.add('is-scrolling-out');

        // Remove fade-out class after animation completes
        fadeTimerRef.current = setTimeout(() => {
          scrollingEl.classList.remove('is-scrolling-out');
        }, FADEOUT_DURATION);
      }, HIDE_DELAY);
    };

    el.addEventListener('scroll', onScroll, { capture, passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll, { capture } as EventListenerOptions);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [ref, capture, filterClass]);
}
