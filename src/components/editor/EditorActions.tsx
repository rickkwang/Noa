import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TocPanel } from './TocPanel';
import { Eye, Edit2, Upload, AlignLeft } from '@/src/lib/icons';

interface EditorActionsProps {
  isDark: boolean;
  viewMode: 'edit' | 'preview';
  setViewMode: (mode: 'edit' | 'preview') => void;
  onExportMd: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onToggleHistory?: () => void;
  isHistoryOpen?: boolean;
  headings: { level: number; text: string; lineIndex: number }[];
  isTocOpen: boolean;
  onToggleToc: () => void;
  onCloseToc: () => void;
  onJumpToLine: (lineIndex: number) => void;
  exportSlot?: HTMLElement | null;
}

export function EditorActions({
  isDark,
  viewMode,
  setViewMode,
  onExportMd,
  onExportHtml,
  onExportPdf,
  onToggleHistory,
  isHistoryOpen,
  headings,
  isTocOpen,
  onToggleToc,
  onCloseToc,
  onJumpToLine,
  exportSlot,
}: EditorActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !isTocOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
      if (!outlineRef.current?.contains(e.target as Node)) onCloseToc();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        onCloseToc();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, isTocOpen, onCloseToc]);

  const nextViewMode = viewMode === 'edit' ? 'preview' : 'edit';
  const nextViewLabel = nextViewMode === 'edit' ? 'Live Preview' : 'Reading view';
  const NextViewModeIcon = nextViewMode === 'edit' ? Edit2 : Eye;
  const buttonClass = 'flex h-6 w-6 items-center justify-center rounded-md noa-press transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default text-[var(--icon-ink,#52514E)] hover:text-[var(--text-primary,#2D2D2B)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)]';
  const itemClass = `flex h-7 shrink-0 cursor-pointer items-center rounded-md px-2 text-body text-left transition-colors whitespace-nowrap ${
    isDark ? 'hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)] text-[rgba(249,249,247,0.9)]' : 'hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)] text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_90%,transparent)]'
  }`;

  const exportMenu = (
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`${buttonClass} ${menuOpen || isHistoryOpen ? 'noa-ink-selected' : ''}`}
          title="More actions"
          aria-label="More actions"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <Upload size={16} />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className={`absolute right-0 top-full mt-1.5 z-50 flex flex-col p-1 min-w-[168px] rounded-panel font-ui noa-floating-panel ${isDark ? 'bg-[var(--bg-primary)]' : 'bg-[var(--surface-page,#F9F9F7)]'}`}
          >
            {onToggleHistory && (
              <>
                <button role="menuitem" onClick={() => { onToggleHistory(); setMenuOpen(false); }} className={itemClass}>
                  Version History
                </button>
                <div className="mx-1 my-1 h-[0.5px] bg-[var(--divider-subtle)]" />
              </>
            )}
            <button role="menuitem" onClick={() => { onExportMd(); setMenuOpen(false); }} className={itemClass}>
              Export as Markdown
            </button>
            <button role="menuitem" onClick={() => { onExportHtml(); setMenuOpen(false); }} className={itemClass}>
              Export as HTML
            </button>
            <button role="menuitem" onClick={() => { onExportPdf(); setMenuOpen(false); }} className={itemClass}>
              Export as PDF
            </button>
          </div>
        )}
      </div>
  );

  return (
    <div className="flex items-center gap-0.5 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div ref={outlineRef} className="relative">
        <button
          onClick={onToggleToc}
          disabled={headings.length === 0}
          className={`${buttonClass} ${isTocOpen ? 'noa-ink-selected' : ''}`}
          title="Outline"
          aria-label="Outline"
          aria-expanded={isTocOpen}
        >
          <AlignLeft size={16} />
        </button>
        {isTocOpen && <TocPanel headings={headings} onJumpToLine={onJumpToLine} onClose={onCloseToc} />}
      </div>
      <button
        onClick={() => setViewMode(nextViewMode)}
        className={buttonClass}
        title={`Switch to ${nextViewLabel} (⌘E)`}
        aria-label={`Switch to ${nextViewLabel}`}
        aria-description={`Current view: ${viewMode === 'edit' ? 'Live Preview' : 'Reading view'}`}
      >
        <NextViewModeIcon size={16} />
      </button>
      {exportSlot ? createPortal(exportMenu, exportSlot) : exportMenu}
    </div>
  );
}
