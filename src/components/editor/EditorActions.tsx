import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  /** Titlebar slot for the export menu. When set, the menu renders there at the titlebar's button size,
   *  in one row with the rail and panel buttons; the view toggle stays with the editor. */
  exportSlot?: HTMLElement | null;
}

/**
 * Note-level controls at the right end of the editor toolbar. The view-mode
 * cycle keeps its own button because it is the one control worth a single
 * click; export and history collapse into one menu, which on desktop moves up
 * into the titlebar (see exportSlot).
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
  exportSlot,
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
    isDark ? 'hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)] text-[rgba(249,249,247,0.9)]' : 'hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)] text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_90%,transparent)]'
  }`;

  const inTitlebar = Boolean(exportSlot);
  const exportMenu = (
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`${inTitlebar ? 'flex h-6 w-6 items-center justify-center' : 'p-1'} rounded-md noa-press transition-colors cursor-pointer ${
            menuOpen || isHistoryOpen
              ? 'noa-ink-selected'
              : inTitlebar
                ? `${isDark ? 'text-[rgba(249,249,247,0.7)] hover:text-[var(--ink-on-dark,#F9F9F7)]' : 'text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_70%,transparent)] hover:text-[var(--text-primary,#2D2D2B)]'} hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)]`
                : `${isDark ? 'text-[color-mix(in_srgb,var(--ink-on-dark,#F9F9F7)_50%,transparent)]' : 'text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_60%,transparent)]'} hover:text-[var(--text-primary,#2D2D2B)]`
          }`}
          title="More actions"
          aria-label="More actions"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          {/* Not a second "more" glyph: the titlebar's panel menu sits beside
              this one. Everything in here but history is an export. */}
          <Upload size={inTitlebar ? 16 : 14} />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className={`absolute right-0 top-full mt-1.5 z-50 flex flex-col p-1 min-w-[168px] rounded-panel font-ui noa-floating-panel ${isDark ? 'bg-[var(--bg-primary)]' : 'bg-[var(--surface-page,#F9F9F7)]'}`}
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
  );

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        onClick={() => setViewMode(nextViewMode)}
        className={`p-1 rounded-md noa-press transition-colors cursor-pointer ${
          isDark ? 'text-[color-mix(in_srgb,var(--ink-on-dark,#F9F9F7)_50%,transparent)] hover:text-[var(--accent-color,#CC7D5E)]' : 'text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_60%,transparent)] hover:text-[var(--accent-color,#CC7D5E)]'
        }`}
        title={`Switch to ${nextViewMode} view`}
        aria-label={`Switch to ${nextViewMode} view`}
        aria-description={`Current view: ${viewMode}`}
      >
        <NextViewModeIcon size={14} />
      </button>

      {exportSlot ? createPortal(exportMenu, exportSlot) : exportMenu}
    </div>
  );
}
