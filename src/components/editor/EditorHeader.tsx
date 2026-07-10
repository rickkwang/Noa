import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText, X, Eye, Edit2, Columns, Plus, History, Download } from '@/src/lib/icons';
import { Note } from '../../types';

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
        className={`flex items-center p-1.5 active:opacity-70 transition-colors ${open ? (isDark ? 'text-[#CC7D5E]' : 'text-[#CC7D5E]') : (isDark ? 'hover:text-[#CC7D5E]' : 'hover:text-[#CC7D5E]')}`}
        title="Export"
      >
        <Download size={14} />
      </button>
      {open && (
        <div className={`absolute right-0 top-full mt-1 z-50 flex flex-col py-1 min-w-[100px] shadow-md ${isDark ? 'bg-[#262624] border border-[#EEEDEA]/10' : 'bg-[#EAE8E0] border border-[#2D2D2D]/15'}`}>
          <button
            onClick={() => { onExportMd(); setOpen(false); }}
            className={`px-3 py-1.5 text-xs text-left transition-colors ${isDark ? 'hover:bg-[#EEEDEA]/08 text-[#EEEDEA]' : 'hover:bg-[#2D2D2D]/06 text-[#2D2D2D]'}`}
          >
            Markdown (.md)
          </button>
          <button
            onClick={() => { onExportHtml(); setOpen(false); }}
            className={`px-3 py-1.5 text-xs text-left transition-colors ${isDark ? 'hover:bg-[#EEEDEA]/08 text-[#EEEDEA]' : 'hover:bg-[#2D2D2D]/06 text-[#2D2D2D]'}`}
          >
            HTML (.html)
          </button>
          <button
            onClick={() => { onExportPdf(); setOpen(false); }}
            className={`px-3 py-1.5 text-xs text-left transition-colors ${isDark ? 'hover:bg-[#EEEDEA]/08 text-[#EEEDEA]' : 'hover:bg-[#2D2D2D]/06 text-[#2D2D2D]'}`}
          >
            PDF (.pdf)
          </button>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(timestamp: string | number | Date): string {
  const then = new Date(timestamp).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

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
  isDark,
  readOnly = false,
}: EditorHeaderProps) {
  const tabStripRef = useRef<HTMLDivElement>(null);
  const pendingInstantTabScrollRef = useRef(false);
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
    // Keep the active tab in view when it changes (e.g. activated via keyboard or
    // sidebar while scrolled off-screen). Skip during the entrance animation and
    // snap into view afterward so the tab strip itself doesn't leave a trail.
    if (enteringTabId && enteringTabId === note.id) {
      pendingInstantTabScrollRef.current = true;
      return;
    }
    const active = scrollEl.querySelector<HTMLElement>('[data-active-tab="true"]');
    const behavior = pendingInstantTabScrollRef.current ? 'auto' : 'smooth';
    pendingInstantTabScrollRef.current = false;
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
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

  // Fade the tab content itself out at overflowing edges (a colored overlay
  // would need to match the themed header background exactly, which the theme
  // layer can override at runtime).
  const maskGradient = edgeFade.left || edgeFade.right
    ? `linear-gradient(to right, ${edgeFade.left ? 'transparent, black 24px' : 'black'}, ${edgeFade.right ? 'black calc(100% - 24px), transparent' : 'black'})`
    : undefined;
  const tabStripMaskStyle: React.CSSProperties = maskGradient
    ? { maskImage: maskGradient, WebkitMaskImage: maskGradient }
    : {};

  return (
    <div className={`h-8 flex items-end justify-between shrink-0 z-10 font-redaction overflow-visible gap-3 pl-1 pr-2 relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:z-0 ${isDark ? 'bg-[#1E1E1C] after:bg-[#EEEDEA]/15' : 'bg-[#DCD9CE] after:bg-[#2D2D2D]'}`}>
      {/* Tab strip */}
      <div className="min-w-0 flex-1 flex items-end overflow-visible">
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
                        className={`editor-tab-divider self-center h-3.5 w-px shrink-0 ${isDark ? 'bg-[#EEEDEA]/15' : 'bg-[#2D2D2D]/20'} ${showSettledDivider ? 'opacity-100' : 'opacity-0'}`}
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
                          ? `z-[1] pt-1 rounded-t-lg ${isDark ? 'bg-[#262624] text-[#EEEDEA]' : 'bg-[#EAE8E0] text-[#2D2D2D]'}`
                          : `bg-transparent border-transparent pt-1 ${isDark ? 'text-[#EEEDEA]/55 hover:text-[#EEEDEA]/80' : 'text-[#2D2D2D]/50 hover:text-[#2D2D2D]/80'}`
                      }`}
                      style={tabStyle}
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
                          className={`text-xs font-bold bg-transparent outline-none border-b w-28 min-w-0 ${isDark ? 'text-[#EEEDEA] border-[#CC7D5E]' : 'text-[#2D2D2D] border-[#CC7D5E]'}`}
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
                        className={`shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity active:opacity-70 ${isDark ? 'text-[#EEEDEA]/30 hover:text-[#CC7D5E]' : 'text-[#2D2D2D]/40 hover:text-[#D45555]'}`}
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
                className={`flex items-center gap-1.5 px-3 pt-1 rounded-t-lg relative z-[1] shrink-0 ${isDark ? 'bg-[#262624]' : 'bg-[#EAE8E0]'}`}
                style={{
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: 'var(--border-primary)',
                  borderBottomColor: 'transparent',
                  paddingBottom: '6px',
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
                    className={`text-xs font-bold bg-transparent outline-none border-b w-28 shrink min-w-0 ${isDark ? 'text-[#EEEDEA] border-[#CC7D5E]' : 'text-[#2D2D2D] border-[#CC7D5E]'}`}
                  />
                ) : (
                  <span
                    className={`text-xs font-bold cursor-text truncate max-w-[120px] ${isDark ? 'text-[#EEEDEA]' : 'text-[#2D2D2D]'}`}
                    onClick={readOnly ? undefined : () => onSetEditingTitle(true)}
                    title={readOnly ? note.title : 'Click to rename'}
                  >
                    {note.title || 'Untitled'}
                  </span>
                )}
                {onClose && (
                  <button onClick={onClose} className={`shrink-0 transition-colors active:opacity-70 ${isDark ? 'text-[#EEEDEA]/30 hover:text-[#CC7D5E]' : 'text-[#2D2D2D]/40 hover:text-[#D45555]'}`}>
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
            className={`flex items-center justify-center w-6 h-6 active:opacity-70 rounded transition-colors shrink-0 self-end ${isDark ? 'text-[#EEEDEA]/30 hover:text-[#EEEDEA]/70 hover:bg-[#262624]' : 'text-[#2D2D2D]/40 hover:text-[#2D2D2D] hover:bg-[#DCD9CE]'}`}
            title="New tab"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Right controls */}
      <div className={`flex items-center gap-3 shrink-0 whitespace-nowrap self-center px-1 ${isDark ? 'text-[#EEEDEA]/50' : 'text-[#2D2D2D]/60'}`}>
        {/* Group 1: view modes */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setViewMode('edit')}
            className={`p-1.5 rounded-md active:opacity-70 transition-colors ${viewMode === 'edit' ? (isDark ? 'text-[#CC7D5E] bg-[#CC7D5E]/15' : 'text-[#CC7D5E] bg-[#CC7D5E]/15') : (isDark ? 'hover:text-[#CC7D5E]' : 'hover:text-[#CC7D5E]')}`}
            title="Edit Only"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`p-1.5 rounded-md active:opacity-70 transition-colors ${viewMode === 'split' ? (isDark ? 'text-[#CC7D5E] bg-[#CC7D5E]/15' : 'text-[#CC7D5E] bg-[#CC7D5E]/15') : (isDark ? 'hover:text-[#CC7D5E]' : 'hover:text-[#CC7D5E]')}`}
            title="Split View"
          >
            <Columns size={14} />
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`p-1.5 rounded-md active:opacity-70 transition-colors ${viewMode === 'preview' ? (isDark ? 'text-[#CC7D5E] bg-[#CC7D5E]/15' : 'text-[#CC7D5E] bg-[#CC7D5E]/15') : (isDark ? 'hover:text-[#CC7D5E]' : 'hover:text-[#CC7D5E]')}`}
            title="Preview Only"
          >
            <Eye size={14} />
          </button>
        </div>

        <div className={`self-stretch w-px shrink-0 my-1.5 ${isDark ? 'bg-[#EEEDEA]/10' : 'bg-[#2D2D2D]/20'}`} />

        {/* Group 2: actions */}
        <div className="flex items-center gap-1 shrink-0">
          <ExportMenu isDark={isDark} onExportMd={onExportMd} onExportHtml={onExportHtml} onExportPdf={onExportPdf} />
          {onToggleHistory && (
            <button
              onClick={onToggleHistory}
              className={`p-1.5 rounded-md active:opacity-70 transition-colors shrink-0 ${isHistoryOpen ? (isDark ? 'text-[#CC7D5E] bg-[#CC7D5E]/15' : 'text-[#CC7D5E] bg-[#CC7D5E]/15') : (isDark ? 'hover:text-[#CC7D5E]' : 'hover:text-[#CC7D5E]')}`}
              title="Version History"
            >
              <History size={14} />
            </button>
          )}
        </div>

        <div className={`self-stretch w-px shrink-0 my-1.5 ${isDark ? 'bg-[#EEEDEA]/10' : 'bg-[#2D2D2D]/20'}`} />

        {/* Group 3: timestamp */}
        <div
          className="text-xs shrink min-w-0 truncate opacity-60 tracking-wide"
          title={new Date(note.updatedAt).toLocaleString()}
        >
          {formatRelativeTime(note.updatedAt)}
        </div>
      </div>
    </div>
  );
}
