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
    <div className={`absolute right-4 top-[68px] z-40 w-56 bg-[#F9F9F7] border-2 border-[#2D2D2B] shadow-[4px_4px_0px_0px_rgba(45,45,43,0.15)] font-redaction max-h-80 overflow-y-auto [scrollbar-gutter:stable] transition-opacity duration-100 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="px-3 py-1.5 bg-[#EFEAE3] border-b border-[#2D2D2B] text-xs font-bold uppercase tracking-wider text-[#2D2D2B]/70 flex items-center justify-between">
        <span>Outline</span>
        <button onClick={handleClose} className="text-[#2D2D2B]/50 hover:text-[#2D2D2B] active:opacity-70">
          <X size={12} />
        </button>
      </div>
      {headings.map((h) => (
        <button
          key={`${h.lineIndex}-${h.text}`}
          onClick={() => onJumpToLine(h.lineIndex)}
          className="w-full text-left px-3 py-1 text-xs hover:bg-[#EFEAE3] text-[#2D2D2B] transition-colors truncate flex items-center"
          style={{ paddingLeft: `${(h.level - 1) * 10 + 12}px` }}
          title={h.text}
        >
          <span className="text-[#CC7D5E] mr-1 shrink-0 font-bold" style={{ fontSize: '9px' }}>
            {'#'.repeat(h.level)}
          </span>
          <span className="truncate">{h.text}</span>
        </button>
      ))}
    </div>
  );
}
