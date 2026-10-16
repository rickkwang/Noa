import React, { useEffect, useState } from 'react';
import { X } from '@/src/lib/icons';

interface TocHeading {
  level: number;
  text: string;
  lineIndex: number;
}

interface TocPanelProps {
  headings: TocHeading[];
  onJumpToLine: (lineIndex: number) => void;
  onClose: () => void;
}

export function TocPanel({ headings, onJumpToLine, onClose }: TocPanelProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 100);
  };

  if (headings.length === 0) return null;

  return (
    <div className={`absolute right-0 top-full mt-1.5 z-50 w-56 bg-[var(--surface-page,#F9F9F7)] rounded-panel p-1 noa-floating-panel font-ui max-h-80 overflow-y-auto [scrollbar-gutter:stable] transition-opacity duration-100 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="flex h-7 items-center justify-between pl-2 pr-1.5 text-caption text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_50%,transparent)]">
        <span>Outline</span>
        <button onClick={handleClose} className="text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_50%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] noa-press" aria-label="Close outline">
          <X size={12} />
        </button>
      </div>
      {headings.map((h) => (
        <button
          key={`${h.lineIndex}-${h.text}`}
          onClick={() => onJumpToLine(h.lineIndex)}
          className="w-full h-7 rounded-md text-left pr-2 text-body hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_8%,transparent)] text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_90%,transparent)] transition-colors truncate flex items-center"
          style={{ paddingLeft: `${(h.level - 1) * 10 + 8}px` }}
          title={h.text}
        >
          <span className="text-[var(--accent-color,#CC7D5E)] mr-1 shrink-0 font-bold" style={{ fontSize: '9px' }}>
            {'#'.repeat(h.level)}
          </span>
          <span className="truncate">{h.text}</span>
        </button>
      ))}
    </div>
  );
}
