import { useState, useCallback, useEffect } from 'react';

export function useResizeDrag(
  initial: number,
  min: number,
  max: number,
  getValue: (e: MouseEvent) => number,
  cursor: string = 'col-resize'
) {
  const [size, setSize] = useState(initial);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) setSize(Math.max(min, Math.min(getValue(e), max)));
  }, [isDragging, min, max, getValue]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [isDragging, handleMouseMove, handleMouseUp, cursor]);

  return { size, setSize, setIsDragging };
}
