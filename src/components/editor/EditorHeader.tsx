import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Note } from '../../types';
import { FileText, X, Eye, Edit2, Columns, Plus, History, Download } from '@/src/lib/icons';

const noDragRegion: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' };
const dragRegion: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'drag' };

function ExportMenu({ isDark, onExportMd, onExportHtml, onExportPdf }: { isDark: boolean; onExportMd: () => void; onExportHtml: () => void; onExportPdf: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center p-1 active:opacity-70 transition-colors ${open ? (isDark ? 'text-[#CC7D5E]' : 'text-[#CC7D5E]') : (isDark ? 'hover:text-[#CC7D5E]' : 'hover:text-[#CC7D5E]')}`}
        title="Export"
        aria-label="Export note"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Download size={14} />
      </button>
      {open && (
        <div className={`absolute right-0 top-full mt-1 z-50 flex flex-col py-1 min-w-[100px] noa-floating-panel ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'} border border-[var(--divider-subtle)]`}>
          <button
            onClick={() => { onExportMd(); setOpen(false); }}
            className={`px-3 py-1.5 text-xs text-left transition-colors ${isDark ? 'hover:bg-[#F9F9F7]/08 text-[#F9F9F7]' : 'hover:bg-[#2D2D2B]/06 text-[#2D2D2B]'}`}
          >
            Markdown (.md)
          </button>
          <button
            onClick={() => { onExportHtml(); setOpen(false); }}
            className={`px-3 py-1.5 text-xs text-left transition-colors ${isDark ? 'hover:bg-[#F9F9F7]/08 text-[#F9F9F7]' : 'hover:bg-[#2D2D2B]/06 text-[#2D2D2B]'}`}
          >
            HTML (.html)
          </button>
          <button
            onClick={() => { onExportPdf(); setOpen(false); }}
            className={`px-3 py-1.5 text-xs text-left transition-colors ${isDark ? 'hover:bg-[#F9F9F7]/08 text-[#F9F9F7]' : 'hover:bg-[#2D2D2B]/06 text-[#2D2D2B]'}`}
          >
            PDF (.pdf)
          </button>
        </div>
      )}
    </div>
  );
}

// Keep in sync with the editor-tab-slot-enter/exit keyframes in index.css.
const TAB_ANIM_MS = 170;

interface EditorTab {
  id: string;
  title: string;
}

interface EditorHeaderProps {
  note: Note;
  tabs?: EditorTab[];
  isEditingTitle: boolean;
  titleInput: string;
  viewMode: 'edit' | 'preview' | 'split';
  enteringTabId?: string | null;
  enteringFromTabId?: string | null;
  closingTabIds?: string[];
  onTitleInputChange: (value: string) => void;
  onTitleSubmit: () => void;
  onTitleKeyDown: (e: React.KeyboardEvent) => void;
  onSetEditingTitle: (v: boolean) => void;
  onTabChange?: (id: string) => void;
  onTabClose?: (id: string) => void;
  onNewTab?: () => void;
  onTabEnterComplete?: (id: string) => void;
  onTabCloseAnimationComplete?: (id: string) => void;
  onClose?: () => void;
  setViewMode: (mode: 'edit' | 'preview' | 'split') => void;
  onExportMd: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  onToggleHistory?: () => void;
  isHistoryOpen?: boolean;
  liftTabStrip?: boolean;
  reserveTitlebarTraffic?: boolean;
  reserveTitlebarActions?: boolean;
  isDark: boolean;
  readOnly?: boolean;
}

export function EditorHeader({
  note,
  tabs,
  isEditingTitle,
  titleInput,
  viewMode,
  enteringTabId,
  enteringFromTabId,
  closingTabIds,
  onTitleInputChange,
  onTitleSubmit,
  onTitleKeyDown,
  onSetEditingTitle,
  onTabChange,
  onTabClose,
  onNewTab,
  onTabEnterComplete,
  onTabCloseAnimationComplete,
  onClose,
  setViewMode,
  onExportMd,
  onExportHtml,
  onExportPdf,
  titleInputRef,
  onToggleHistory,
  isHistoryOpen,
  liftTabStrip = false,
  reserveTitlebarTraffic = false,
  reserveTitlebarActions = false,
  isDark,
  readOnly = false,
}: EditorHeaderProps) {
  const tabStripRef = useRef<HTMLDivElement>(null);
  // Track IME composition so we don't commit a half-typed CJK title when the
  // user presses Enter or blurs mid-selection.
  const isComposingRef = useRef(false);
  const handleCompositionStart = () => { isComposingRef.current = true; };
  const handleCompositionEnd = () => { isComposingRef.current = false; };
  const handleTitleBlur = () => { if (!isComposingRef.current) onTitleSubmit(); };
  const handleTitleKeyDownGuarded = (e: React.KeyboardEvent) => {
    // Swallow Enter while composing; some IMEs fire Enter to accept a candidate.
    // keyCode 229 is the legacy "composition in progress" marker.
    if (isComposingRef.current || e.nativeEvent.isComposing || (e as unknown as { keyCode: number }).keyCode === 229) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    onTitleKeyDown(e);
  };
  const shouldAnimateEnteringTab = Boolean(enteringTabId && tabs?.some(tab => tab.id === enteringTabId));
  const [edgeFade, setEdgeFade] = useState({ left: false, right: false });

  const updateEdgeFade = () => {
    const el = tabStripRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdgeFade(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
  };

  useLayoutEffect(() => {
    const scrollEl = tabStripRef.current;
    if (!scrollEl) return;
    // A new tab is always appended at the end, so follow the strip's right edge
    // while it widens and it reads as sliding in at that edge. Letting the
    // entrance finish and snapping into view afterward instead teleported the
    // whole strip a full tab-width in a single frame (measured: 73px, 3/3).
    if (enteringTabId && enteringTabId === note.id) {
      // Ease to the edge rather than pinning to it: the strip is often parked
      // far from the right (browsing older tabs, then opening a note that isn't
      // open yet), and jumping straight to scrollWidth teleported it by up to
      // 1098px in a single frame. Duration matches editor-tab-slot-enter.
      const from = scrollEl.scrollLeft;
      const start = performance.now();
      let raf = 0;
      const followRightEdge = () => {
        const p = Math.min(1, (performance.now() - start) / TAB_ANIM_MS);
        const eased = 1 - (1 - p) ** 3;
        const max = scrollEl.scrollWidth - scrollEl.clientWidth;
        scrollEl.scrollLeft = from + (max - from) * eased;
        if (p < 1) raf = requestAnimationFrame(followRightEdge);
      };
      followRightEdge();
      return () => cancelAnimationFrame(raf);
    }
    // Otherwise keep the active tab in view when it changes (e.g. activated via
    // keyboard or the sidebar while scrolled off-screen).
    const active = scrollEl.querySelector<HTMLElement>('[data-active-tab="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [tabs, note.id, enteringTabId]);

  useEffect(() => {
    const scrollEl = tabStripRef.current;
    if (!scrollEl) return;
    // The strip clips overflowing tabs with a hidden scrollbar, so a window
    // resize can silently push the active tab out of view. Re-snap it whenever
    // the strip itself changes size.
    const observer = new ResizeObserver(() => {
      const active = scrollEl.querySelector<HTMLElement>('[data-active-tab="true"]');
      active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
      updateEdgeFade();
    });
    observer.observe(scrollEl);
    scrollEl.addEventListener('scroll', updateEdgeFade, { passive: true });
    return () => {
      observer.disconnect();
      scrollEl.removeEventListener('scroll', updateEdgeFade);
    };
  }, []);

  useLayoutEffect(updateEdgeFade, [tabs]);

  // Mirror of what the close button does for the exit animation: stamp the
  // entering tab with the width it is animating toward. Siblings are already at
  // that width (once the strip overflows every tab sits at its 4.5rem minimum),
  // and the entering tab is still at max-width:0 on this frame, so measuring one
  // is safe. markEnteringTab only fires when tabs already exist, so there is
  // always a sibling to measure.
  useLayoutEffect(() => {
    if (!shouldAnimateEnteringTab || !enteringTabId) return;
    const strip = tabStripRef.current;
    if (!strip) return;
    const tabEls = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]'));
    const entering = tabEls.find(el => el.dataset.tabId === enteringTabId);
    const settled = tabEls.find(el => el !== entering && !el.dataset.closingTab);
    if (entering && settled) entering.style.setProperty('--noa-tab-w', `${settled.offsetWidth}px`);
  }, [shouldAnimateEnteringTab, enteringTabId]);

  // Fade the tab content itself out at overflowing edges (a colored overlay
  // would need to match the themed header background exactly, which the theme
  // layer can override at runtime).
  const maskGradient = edgeFade.left || edgeFade.right
    ? `linear-gradient(to right, ${edgeFade.left ? 'transparent, black 24px' : 'black'}, ${edgeFade.right ? 'black calc(100% - 24px), transparent' : 'black'})`
    : undefined;
  const tabStripMaskStyle: React.CSSProperties = maskGradient
    ? { maskImage: maskGradient, WebkitMaskImage: maskGradient }
    : {};
  const nextViewMode = viewMode === 'edit' ? 'split' : viewMode === 'split' ? 'preview' : 'edit';
  const nextViewModeLabel = nextViewMode === 'edit' ? 'edit' : nextViewMode === 'split' ? 'split' : 'preview';
  // Show the destination rather than the already-active mode: a lone icon then
  // visibly changes on every click, making the three-step cycle legible.
  const NextViewModeIcon = nextViewMode === 'edit' ? Edit2 : nextViewMode === 'split' ? Columns : Eye;

  return (
    <div
      className={`h-8 flex items-end justify-between shrink-0 z-10 font-redaction overflow-visible gap-3 relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:z-0 ${liftTabStrip ? '-mt-8' : ''} ${isDark ? 'bg-[#2D2D2B] after:bg-[#F9F9F7]/15' : 'bg-[#F9F9F7] after:bg-[#E6E2DA]'}`}
      style={{
        ...dragRegion,
        paddingLeft: liftTabStrip && reserveTitlebarTraffic ? '9rem' : '0.25rem',
        paddingRight: reserveTitlebarActions ? '7.25rem' : '0.5rem',
        transition: liftTabStrip ? 'padding 220ms cubic-bezier(0.4, 0, 0.2, 1)' : undefined,
      }}
    >
      {/* Tab strip */}
      <div
        className="min-w-0 flex-1 flex items-end overflow-visible"
        style={{
          marginLeft: liftTabStrip && reserveTitlebarTraffic
            ? 'var(--noa-titlebar-search-extra, 0px)'
            : undefined,
          transition: liftTabStrip ? 'margin-left 220ms cubic-bezier(0.4, 0, 0.2, 1)' : undefined,
        }}
      >
        {/* z-[1] keeps the strip above the header's bottom line even when the
            mask-image below forces this subtree into its own stacking context */}
        <div className="relative z-[1] min-w-0 flex items-end overflow-visible">
          <div
            ref={tabStripRef}
            className="min-w-0 flex-1 flex items-end overflow-x-auto overflow-y-visible [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            style={{ scrollPaddingInline: '10px', ...tabStripMaskStyle }}
          >
            <div className="flex items-end pt-1 w-full">
            {tabs && tabs.length > 0 ? (
              tabs.map((tab, idx) => {
                const isActiveTab = tab.id === note.id;
                const prevTab = idx > 0 ? tabs[idx - 1] : null;
                const prevIsActive = prevTab?.id === note.id;
                const prevIsEntering = Boolean(prevTab && enteringTabId === prevTab.id);
                const isEnteringFromTab = enteringFromTabId === tab.id;
                const prevIsEnteringFromTab = Boolean(prevTab && enteringFromTabId === prevTab.id);
                const showDivider = idx > 0 && !isActiveTab && !prevIsActive;
                const isEnteringTab = shouldAnimateEnteringTab && enteringTabId === tab.id;
                const isClosingTab = closingTabIds?.includes(tab.id) ?? false;
                const prevIsClosing = Boolean(prevTab && (closingTabIds?.includes(prevTab.id) ?? false));
                const showSettledDivider = showDivider && !isEnteringTab && !prevIsEntering && !isEnteringFromTab && !prevIsEnteringFromTab && !isClosingTab && !prevIsClosing;
                const tabStyle = {
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: isActiveTab ? 'var(--border-primary)' : 'transparent',
                  borderBottomColor: isActiveTab ? 'transparent' : undefined,
                  paddingBottom: '6px',
                } as React.CSSProperties;
                return (
                  <React.Fragment key={tab.id}>
                    {idx > 0 && (
                      <div
                        className={`editor-tab-divider self-center h-3.5 w-px shrink-0 ${isDark ? 'bg-[#F9F9F7]/15' : 'bg-[#E6E2DA]'} ${showSettledDivider ? 'opacity-100' : 'opacity-0'}`}
                        aria-hidden="true"
                      />
                    )}
                    <div
                      data-tab-id={tab.id}
                      data-active-tab={isActiveTab}
                      data-closing-tab={isClosingTab || undefined}
                      onClick={() => { if (!isClosingTab) onTabChange?.(tab.id); }}
                      onAnimationEnd={(event) => {
                        if (event.currentTarget !== event.target) return;
                        if (isClosingTab) onTabCloseAnimationComplete?.(tab.id);
                        if (isEnteringTab) onTabEnterComplete?.(tab.id);
                      }}
                      className={`group editor-tab ${isEnteringTab ? 'editor-tab-enter' : ''} ${isClosingTab ? 'editor-tab-exit' : ''} flex items-center gap-1.5 px-3 cursor-pointer transition-colors relative flex-1 min-w-[4.5rem] max-w-[9rem] ${
                        isActiveTab
                          ? `z-[1] pt-1 rounded-t-lg ${isDark ? 'bg-[#2D2D2B] text-[#F9F9F7]' : 'bg-[#F9F9F7] text-[#2D2D2B]'}`
                          : `bg-transparent border-transparent pt-1 ${isDark ? 'text-[#F9F9F7]/55 hover:text-[#F9F9F7]/80' : 'text-[#2D2D2B]/50 hover:text-[#2D2D2B]/80'}`
                      }`}
                      style={{ ...tabStyle, ...noDragRegion }}
                    >
                      <FileText size={12} className={isActiveTab ? (isDark ? 'text-[#CC7D5E] shrink-0' : 'text-[#CC7D5E] shrink-0') : 'shrink-0'} />
                      {isActiveTab && isEditingTitle ? (
                        <input
                          ref={titleInputRef}
                          type="text"
                          value={titleInput}
                          onChange={(e) => onTitleInputChange(e.target.value)}
                          onBlur={handleTitleBlur}
                          onKeyDown={handleTitleKeyDownGuarded}
                          onCompositionStart={handleCompositionStart}
                          onCompositionEnd={handleCompositionEnd}
                          disabled={readOnly}
                          className={`text-xs font-bold bg-transparent outline-none border-b w-28 min-w-0 ${isDark ? 'text-[#F9F9F7] border-[#CC7D5E]' : 'text-[#2D2D2B] border-[#CC7D5E]'}`}
                        />
                      ) : (
                        <span
                          className="text-xs font-bold truncate min-w-0 flex-1"
                          onDoubleClick={isActiveTab && !readOnly ? () => onSetEditingTitle(true) : undefined}
                          title={isActiveTab && !readOnly ? 'Double-click to rename' : tab.title}
                        >
                          {tab.title || 'Untitled'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Capture the tab's real width before the exit animation
                          // starts, so the collapse begins from the actual width
                          // instead of the 9rem max — otherwise squeezed tabs
                          // stall for the first half of the animation.
                          const tabEl = e.currentTarget.closest<HTMLElement>('[data-tab-id]');
                          if (tabEl) tabEl.style.setProperty('--noa-tab-w', `${tabEl.offsetWidth}px`);
                          onTabClose?.(tab.id);
                        }}
                        className={`shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity active:opacity-70 ${isDark ? 'text-[#F9F9F7]/30 hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/40 hover:text-[#D45555]'}`}
                        aria-label={`Close ${tab.title || 'Untitled'} tab`}
                        title="Close tab"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </React.Fragment>
                );
              })
            ) : (
              /* Fallback: single tab (legacy mode) */
              <div
                className={`flex items-center gap-1.5 px-3 pt-1 rounded-t-lg relative z-[1] shrink-0 ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'}`}
                style={{
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: 'var(--border-primary)',
                  borderBottomColor: 'transparent',
                  paddingBottom: '6px',
                  ...noDragRegion,
                }}
              >
                <FileText size={12} className={isDark ? 'text-[#CC7D5E] shrink-0' : 'text-[#CC7D5E] shrink-0'} />
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={titleInput}
                    onChange={(e) => onTitleInputChange(e.target.value)}
                    onBlur={handleTitleBlur}
                    onKeyDown={handleTitleKeyDownGuarded}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    disabled={readOnly}
                    className={`text-xs font-bold bg-transparent outline-none border-b w-28 shrink min-w-0 ${isDark ? 'text-[#F9F9F7] border-[#CC7D5E]' : 'text-[#2D2D2B] border-[#CC7D5E]'}`}
                  />
                ) : (
                  <span
                    className={`text-xs font-bold cursor-text truncate max-w-[120px] ${isDark ? 'text-[#F9F9F7]' : 'text-[#2D2D2B]'}`}
                    onClick={readOnly ? undefined : () => onSetEditingTitle(true)}
                    title={readOnly ? note.title : 'Click to rename'}
                  >
                    {note.title || 'Untitled'}
                  </span>
                )}
                {onClose && (
                  <button onClick={onClose} className={`shrink-0 transition-colors active:opacity-70 ${isDark ? 'text-[#F9F9F7]/30 hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/40 hover:text-[#D45555]'}`} aria-label="Close tab" title="Close tab">
                    <X size={11} />
                  </button>
                )}
              </div>
            )}
            </div>
          </div>
        </div>
        {onNewTab && (
          <button
            onClick={onNewTab}
            className={`flex items-center justify-center w-6 h-6 active:opacity-70 rounded transition-colors shrink-0 self-end ${isDark ? 'text-[#F9F9F7]/30 hover:text-[#F9F9F7]/70 hover:bg-[#2D2D2B]' : 'text-[#2D2D2B]/40 hover:text-[#2D2D2B] hover:bg-[#EFEAE3]'}`}
            style={noDragRegion}
            title="New tab"
            aria-label="New tab"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Right controls */}
      <div
        className={`flex items-center gap-3 shrink-0 translate-x-[10px] whitespace-nowrap self-center px-1 ${isDark ? 'text-[#F9F9F7]/50' : 'text-[#2D2D2B]/60'}`}
        style={noDragRegion}
      >
        {/* Group 1: view modes */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => setViewMode(nextViewMode)}
              className="p-1 rounded-md text-[#CC7D5E] bg-[#CC7D5E]/15 hover:text-[#CC7D5E] active:opacity-70 transition-colors"
              title={`Switch to ${nextViewModeLabel} view`}
              aria-label={`Switch to ${nextViewModeLabel} view`}
              aria-description={`Current view: ${viewMode}`}
            >
              <NextViewModeIcon size={14} />
            </button>
          </div>

          <div className={`h-4 w-px shrink-0 ${isDark ? 'bg-[#F9F9F7]/10' : 'bg-[#E6E2DA]'}`} />

        {/* Group 2: actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <ExportMenu isDark={isDark} onExportMd={onExportMd} onExportHtml={onExportHtml} onExportPdf={onExportPdf} />
          {onToggleHistory && (
            <button
              onClick={onToggleHistory}
              className={`px-1.5 py-1 rounded-md active:opacity-70 transition-colors shrink-0 ${isHistoryOpen ? (isDark ? 'text-[#CC7D5E] bg-[#CC7D5E]/15' : 'text-[#CC7D5E] bg-[#CC7D5E]/15') : (isDark ? 'hover:text-[#CC7D5E]' : 'hover:text-[#CC7D5E]')}`}
              title="Version History"
              aria-label="Version history"
              aria-pressed={isHistoryOpen ?? false}
            >
              <History size={14} />
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
