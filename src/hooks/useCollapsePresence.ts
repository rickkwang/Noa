import { useEffect, useState } from 'react';

// Mirrors the closing transition of .noa-sidebar-collapse in index.css.
const SIDEBAR_COLLAPSE_MS = 220;

/**
 * Keeps a collapsible body mounted for the length of its collapse, so closing
 * eases the content away instead of unmounting it on the first frame. Opening
 * mounts in the same render that flips the section open — a mount deferred to
 * an effect would paint one frame of an empty, already-growing track.
 */
export function useCollapsePresence(isOpen: boolean): boolean {
  const [isMounted, setIsMounted] = useState(isOpen);
  if (isOpen && !isMounted) setIsMounted(true);

  // A timer, not transitionend: the collapse's track is already at 0 by the
  // time this fires, so unmounting a frame early or late shows nothing, and
  // under reduced motion there is no transition to end.
  useEffect(() => {
    if (isOpen || !isMounted) return;
    const timer = window.setTimeout(() => setIsMounted(false), SIDEBAR_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen, isMounted]);

  return isOpen || isMounted;
}
