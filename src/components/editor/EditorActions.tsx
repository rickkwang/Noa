import React, { useEffect, useRef, useState } from 'react';
import { Eye, Edit2, Upload } from '@/src/lib/icons';

interface EditorActionsProps {
  isDark: boolean;
  viewMode: 'edit' | 'preview';
  setViewMode: (mode: 'edit' | 'preview') => void;
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

  const nextViewMode = viewMode === 'edit' ? 'preview' : 'edit';
  // Show the destination rather than the already-active mode: a lone icon then
  // visibly changes on every click.
  const NextViewModeIcon = nextViewMode === 'edit' ? Edit2 : Eye;

  // Same row as the titlebar's panel menu (PaneMenu): every popup menu in the
  // app shares one shape — 10px panel, 4px inset, 28px rounded rows.
  const itemClass = `flex h-7 shrink-0 cursor-pointer items-center rounded-md px-2 text-body text-left transition-colors whitespace-nowrap ${
    isDark ? 'hover:bg-[var(--bg-sidebar-raised,#ECEBE8)] text-[rgba(249,249,247,0.9)]' : 'hover:bg-[var(--bg-sidebar-raised,#ECEBE8)] text-[#2D2D2B]/90'
  }`;

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        onClick={() => setViewMode(nextViewMode)}
        className={`p-1 rounded-md noa-press transition-colors cursor-pointer ${
          isDark ? 'text-[#F9F9F7]/50 hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/60 hover:text-[#CC7D5E]'
        }`}
        title={`Switch to ${nextViewMode} view`}
        aria-label={`Switch to ${nextViewMode} view`}
        aria-description={`Current view: ${viewMode}`}
      >
        <NextViewModeIcon size={14} />
      </button>

      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`p-1 rounded-md noa-press transition-colors cursor-pointer ${
            menuOpen || isHistoryOpen
              ? 'noa-ink-selected'
              : `${isDark ? 'text-[#F9F9F7]/50' : 'text-[#2D2D2B]/60'} hover:text-[var(--text-primary,#2D2D2B)]`
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
            className={`absolute right-0 top-full mt-1.5 z-50 flex flex-col p-1 min-w-[168px] rounded-panel font-ui noa-floating-panel ${isDark ? 'bg-[var(--bg-primary)]' : 'bg-[#F9F9F7]'}`}
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
    </div>
  );
}
