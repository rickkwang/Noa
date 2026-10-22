import { useCallback, useEffect, useRef, useState } from 'react';

type CaptureNotice = 'copied' | 'saved' | 'failed' | 'blocked' | null;

/** The same frame captured twice, so the dialog's "Hide names" switch needs no retake. */
export interface WindowShot {
  redacted: string;
  plain: string;
  /** Image pixels per CSS pixel, for sizing the blur cells. */
  scale: number;
}

const NOTICE_MS = 3000;

// rAF stalls in a throttled window; the timeout keeps the capture from hanging.
function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
    window.setTimeout(resolve, 120);
  });
}

async function settle() {
  await nextFrame();
  await nextFrame();
}

/**
 * Desktop-only window screenshot. Note, folder and tag names are swapped for placeholder bars
 * (`data-capture-redact` in index.css) in the DOM before capture rather than blurred afterwards,
 * so the redacted image never contains the glyphs.
 */
export function useWindowCapture() {
  const [shot, setShot] = useState<WindowShot | null>(null);
  const [notice, setNotice] = useState<CaptureNotice>(null);
  const busyRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);
  const isAvailable = Boolean(window.noaDesktop?.capture);

  const showNotice = useCallback((next: CaptureNotice) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice(next);
    noticeTimerRef.current = next === null ? null : window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, NOTICE_MS);
  }, []);

  const capture = useCallback(async () => {
    const bridge = window.noaDesktop?.capture;
    if (!bridge || busyRef.current) return;
    busyRef.current = true;
    // Neither the dialog (on retake) nor a leftover notice may land in the image.
    setShot(null);
    showNotice(null);
    // Let those unmount, along with the command palette when the capture came from it. Any modal still
    // open after that would be captured over the window, so it has to be closed first.
    await settle();
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
      busyRef.current = false;
      showNotice('blocked');
      return;
    }
    const root = document.documentElement;
    // Focus rings and the editor caret would land in the image; focus goes back afterwards.
    const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    focused?.blur();
    const translucentSidebar = root.dataset.translucentSidebar;
    // capturePage sees only the page, not the native sidebar material behind it; paint the opaque fallback.
    root.dataset.translucentSidebar = 'disabled';
    // Nor the native traffic lights: index.css stands in for them while this is set.
    if (/Mac/.test(navigator.platform)) root.dataset.captureChrome = 'true';
    let next: WindowShot | null = null;
    try {
      root.dataset.captureRedact = 'true';
      await settle();
      const redacted = await bridge.capturePage();
      delete root.dataset.captureRedact;
      await settle();
      const plain = await bridge.capturePage();
      if (redacted && plain) next = { redacted, plain, scale: window.devicePixelRatio || 1 };
    } catch {
      next = null;
    } finally {
      delete root.dataset.captureRedact;
      delete root.dataset.captureChrome;
      if (translucentSidebar === undefined) delete root.dataset.translucentSidebar;
      else root.dataset.translucentSidebar = translucentSidebar;
      if (focused?.isConnected) focused.focus({ preventScroll: true });
      busyRef.current = false;
    }
    if (next) setShot(next);
    else showNotice('failed');
  }, [showNotice]);

  const copy = useCallback(async (dataUrl: string) => {
    const ok = await window.noaDesktop?.capture?.copyImage(dataUrl).catch(() => false);
    if (ok) setShot(null);
    showNotice(ok ? 'copied' : 'failed');
  }, [showNotice]);

  const save = useCallback(async (dataUrl: string) => {
    const result = await window.noaDesktop?.capture?.saveImage(dataUrl).catch(() => 'failed' as const);
    if (result === 'canceled') return;
    if (result === 'saved') setShot(null);
    showNotice(result === 'saved' ? 'saved' : 'failed');
  }, [showNotice]);

  const close = useCallback(() => setShot(null), []);
  const renderFailed = useCallback(() => showNotice('failed'), [showNotice]);

  useEffect(() => window.noaDesktop?.capture?.onRequest(() => { void capture(); }), [capture]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  return { isAvailable, shot, notice, capture, copy, save, renderFailed, close };
}
