import { useEffect } from 'react';

const HIDE_DELAY = 1200;
const FADEOUT_DURATION = 600; // matches the 0.6s scrollbar-fadeout animation in index.css

interface ScrollTimers {
  hide: ReturnType<typeof setTimeout>;
  fade?: ReturnType<typeof setTimeout>;
}

/**
 * Tags whichever element is scrolling with `.is-scrolling` (then
 * `.is-scrolling-out` after an idle delay) so the overlay scrollbar thumb in
 * index.css fades in and out. Mount once at the app root: scroll events don't
 * bubble, but a capturing listener on document sees them for every element.
 */
export function useGlobalScrollingClass() {
  useEffect(() => {
    const timers = new Map<HTMLElement, ScrollTimers>();

    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;

      const pending = timers.get(el);
      if (pending) {
        clearTimeout(pending.hide);
        if (pending.fade) clearTimeout(pending.fade);
      }
      el.classList.remove('is-scrolling-out');
      el.classList.add('is-scrolling');

      const hide = setTimeout(() => {
        el.classList.remove('is-scrolling');
        el.classList.add('is-scrolling-out');
        const fade = setTimeout(() => {
          el.classList.remove('is-scrolling-out');
          timers.delete(el);
        }, FADEOUT_DURATION);
        timers.set(el, { hide, fade });
      }, HIDE_DELAY);
      timers.set(el, { hide });
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      timers.forEach(({ hide, fade }) => {
        clearTimeout(hide);
        if (fade) clearTimeout(fade);
      });
      timers.clear();
    };
  }, []);
}
