import { useState, useRef, useEffect } from 'react';

export function useResizeDrag(
  initial: number,
  min: number,
  max: number,
  getValue: (e: MouseEvent) => number,
  cursor: string = 'col-resize'
) {
  const [size, setSize] = useState(initial);
  const [isDragging, setIsDragging] = useState(false);

  // Use refs to avoid re-creating listeners on every state change
  const isDraggingRef = useRef(isDragging);
  const getValueRef = useRef(getValue);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);
  useEffect(() => { getValueRef.current = getValue; }, [getValue]);
  useEffect(() => { minRef.current = min; maxRef.current = max; }, [min, max]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setSize(Math.max(minRef.current, Math.min(getValueRef.current(e), maxRef.current)));
    };
    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [isDragging, cursor]);

  return { size, setSize, setIsDragging };
}
