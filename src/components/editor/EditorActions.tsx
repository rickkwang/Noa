import React, { useEffect, useRef, useState } from 'react';
import { Eye, Edit2, Columns, Upload } from '@/src/lib/icons';

interface EditorActionsProps {
  isDark: boolean;
  viewMode: 'edit' | 'preview' | 'split';
  setViewMode: (mode: 'edit' | 'preview' | 'split') => void;
  /** False on phone widths, where two panes cannot both be readable. */
  allowSplit?: boolean;
  onExportMd: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onToggleHistory?: () => void;
  isHistoryOpen?: boolean;
}

/**
 * Note-level controls at the right end of the tab strip. The view-mode cycle
 * keeps its own button because it is the one control worth a single click;
 * export and history collapse into the overflow menu.
 */
export function EditorActions({
  isDark,
  viewMode,
  setViewMode,
  allowSplit = true,
  onExportMd,
  onExportHtml,
  onExportPdf,
  onToggleHistory,
  isHistoryOpen,
}: EditorActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const nextViewMode = viewMode === 'edit' ? (allowSplit ? 'split' : 'preview') : viewMode === 'split' ? 'preview' : 'edit';
  const nextViewModeLabel = nextViewMode === 'edit' ? 'edit' : nextViewMode === 'split' ? 'split' : 'preview';
  // Show the destination rather than the already-active mode: a lone icon then
  // visibly changes on every click, making the three-step cycle legible.
  const NextViewModeIcon = nextViewMode === 'edit' ? Edit2 : nextViewMode === 'split' ? Columns : Eye;

  // Same row as the titlebar's panel menu (PaneMenu): every popup menu in the
  // app shares one shape — 10px panel, 4px inset, 28px rounded rows.
  const itemClass = `flex h-7 shrink-0 cursor-pointer items-center rounded-md px-2 text-[13px] text-left transition-colors whitespace-nowrap ${
    isDark ? 'hover:bg-[rgba(249,249,247,0.07)] text-[rgba(249,249,247,0.9)]' : 'hover:bg-[#2D2D2B]/[0.05] text-[#2D2D2B]/90'
  }`;

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        onClick={() => setViewMode(nextViewMode)}
        className={`p-1 rounded-md active:opacity-70 transition-colors cursor-pointer ${
          isDark ? 'text-[#F9F9F7]/50 hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/60 hover:text-[#CC7D5E]'
        }`}
        title={`Switch to ${nextViewModeLabel} view`}
        aria-label={`Switch to ${nextViewModeLabel} view`}
        aria-description={`Current view: ${viewMode}`}
      >
        <NextViewModeIcon size={14} />
      </button>

      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`p-1 rounded-md active:opacity-70 transition-colors cursor-pointer ${
            menuOpen || isHistoryOpen
              ? 'text-[#CC7D5E] bg-[#CC7D5E]/15'
              : `${isDark ? 'text-[#F9F9F7]/50' : 'text-[#2D2D2B]/60'} hover:text-[#CC7D5E]`
          }`}
          title="More actions"
          aria-label="More actions"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          {/* Not a second "more" glyph: the titlebar's panel menu sits right
              above this one. Everything in here but history is an export. */}
          <Upload size={14} />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className={`absolute right-0 top-full mt-1.5 z-50 flex flex-col p-1 min-w-[168px] rounded-[10px] font-redaction noa-floating-panel border border-[var(--divider-subtle)] ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'}`}
          >
            {onToggleHistory && (
              <>
                <button
                  role="menuitem"
                  onClick={() => { onToggleHistory(); setMenuOpen(false); }}
                  className={itemClass}
                >
                  Version History
                </button>
                <div className="mx-1 my-1 h-px bg-[var(--divider-subtle)]" />
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
    </div>
  );
}
