import { useState, useRef, useEffect } from 'react';

export function useResizeDrag(
  initial: number,
  min: number,
  max: number,
  getValue: (e: MouseEvent) => number,
  cursor: string = 'col-resize',
  onPreview?: (size: number) => void
) {
  const [size, setSize] = useState(initial);
  const [isDragging, setIsDragging] = useState(false);
  const frameRef = useRef<number | null>(null);
  const pendingSizeRef = useRef<number | null>(null);
  const latestSizeRef = useRef(initial);

  // Use refs to avoid re-creating listeners on every state change
  const getValueRef = useRef(getValue);
  const onPreviewRef = useRef(onPreview);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  useEffect(() => { getValueRef.current = getValue; }, [getValue]);
  useEffect(() => { onPreviewRef.current = onPreview; }, [onPreview]);
  useEffect(() => { minRef.current = min; maxRef.current = max; }, [min, max]);

  useEffect(() => {
    if (!isDragging) return;

    const commitPendingSize = (commitState: boolean) => {
      frameRef.current = null;
      const nextSize = pendingSizeRef.current;
      pendingSizeRef.current = null;
      if (nextSize !== null) {
        latestSizeRef.current = nextSize;
        onPreviewRef.current?.(nextSize);
        if (commitState || !onPreviewRef.current) {
          setSize(currentSize => currentSize === nextSize ? currentSize : nextSize);
        }
      } else if (commitState) {
        setSize(currentSize => currentSize === latestSizeRef.current ? currentSize : latestSizeRef.current);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingSizeRef.current = Math.max(minRef.current, Math.min(getValueRef.current(e), maxRef.current));
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(() => commitPendingSize(false));
      }
    };
    const handleMouseUp = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      commitPendingSize(true);
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      pendingSizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [isDragging, cursor]);

  return { size, setSize, isDragging, setIsDragging };
}
