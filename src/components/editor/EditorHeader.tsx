import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Note } from '../../types';
import { FileText, X, Plus } from '@/src/lib/icons';

const noDragRegion: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' };
const dragRegion: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'drag' };

// Keep in sync with the editor-tab-slot-enter/exit keyframes in index.css, and
// with TAB_ENTER_FALLBACK_MS / TAB_EXIT_FALLBACK_MS in useTabs.
const TAB_ANIM_MS = 170;

// Stable identity for the optional id lists, so the memos below don't rebuild on
// every render when the caller omits them.
const NO_TAB_IDS: string[] = [];

interface EditorTab {
  id: string;
  title: string;
}

interface EditorHeaderProps {
  note: Note;
  tabs?: EditorTab[];
  isEditingTitle: boolean;
  titleInput: string;
  enteringTabIds?: string[];
  enteringFromTabIds?: string[];
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
  titleInputRef: React.RefObject<HTMLInputElement | null>;
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
  enteringTabIds = NO_TAB_IDS,
  enteringFromTabIds = NO_TAB_IDS,
  closingTabIds = NO_TAB_IDS,
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
  titleInputRef,
  liftTabStrip = false,
  reserveTitlebarTraffic = false,
  reserveTitlebarActions = false,
  isDark,
  readOnly = false,
}: EditorHeaderProps) {
  const tabStripRef = useRef<HTMLDivElement>(null);
  const tabStripFrameRef = useRef<HTMLDivElement>(null);
  const entranceScrollOwnerRef = useRef<string | null>(null);
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
  const enteringTabIdSet = useMemo(() => new Set(enteringTabIds), [enteringTabIds]);
  const enteringFromTabIdSet = useMemo(() => new Set(enteringFromTabIds), [enteringFromTabIds]);
  const closingTabIdSet = useMemo(() => new Set(closingTabIds), [closingTabIds]);
  const isEnteringActiveTab = enteringTabIdSet.has(note.id);
  const anyTabAnimating = enteringTabIds.length > 0 || closingTabIds.length > 0;
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
    if (isEnteringActiveTab) {
      entranceScrollOwnerRef.current = note.id;
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
    // The entrance that just ended already parked the strip at its right edge.
    // Without this guard, clearing the entering flag re-ran the effect and fired
    // a second, smooth scroll on the exact frame the entrance landed. Keyed on
    // the tab that was entering, not a bare flag: switching to a different tab
    // mid-entrance also clears isEnteringActiveTab, and that tab does still need
    // to be scrolled into view.
    const entranceOwner = entranceScrollOwnerRef.current;
    entranceScrollOwnerRef.current = null;
    if (entranceOwner === note.id) return;
    // Otherwise keep the active tab in view when it changes (e.g. activated via
    // keyboard or the sidebar while scrolled off-screen).
    const active = scrollEl.querySelector<HTMLElement>('[data-active-tab="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [tabs, note.id, isEnteringActiveTab]);

  useEffect(() => {
    const scrollEl = tabStripRef.current;
    const frameEl = tabStripFrameRef.current;
    if (!scrollEl || !frameEl) return;
    // The strip clips overflowing tabs with a hidden scrollbar, so a window
    // resize can silently push the active tab out of view. Re-snap it whenever
    // the space available to the strip changes.
    //
    // Observe the frame, not the strip. The strip is shrink-to-fit, so its own
    // width tracks its content and it resizes on every frame of a tab
    // enter/exit — observing it re-snapped and re-measured on those frames
    // (measured: 22 callbacks per entrance) while the entrance's rAF was
    // writing scrollLeft. The frame is the flex-1 wrapper, so it only changes
    // with the window, sidebar, or right panel: exactly the cases that need a
    // re-snap, and none of the cases the animations already handle.
    const observer = new ResizeObserver(() => {
      const active = scrollEl.querySelector<HTMLElement>('[data-active-tab="true"]');
      active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
      updateEdgeFade();
    });
    observer.observe(frameEl);
    scrollEl.addEventListener('scroll', updateEdgeFade, { passive: true });
    return () => {
      observer.disconnect();
      scrollEl.removeEventListener('scroll', updateEdgeFade);
    };
  }, []);

  useLayoutEffect(updateEdgeFade, [tabs, anyTabAnimating]);

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
    <div
      className={`h-8 flex items-end justify-between shrink-0 z-10 font-redaction overflow-visible gap-3 relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:z-0 after:bg-[var(--divider-subtle)] ${liftTabStrip ? '-mt-8' : ''} ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'}`}
      style={{
        ...dragRegion,
        paddingLeft: '0.75rem',
        paddingRight: '0.5rem',
        marginLeft: liftTabStrip && reserveTitlebarTraffic ? '9rem' : undefined,
        marginRight: reserveTitlebarActions ? '7.25rem' : undefined,
        transition: liftTabStrip ? 'margin 220ms cubic-bezier(0.4, 0, 0.2, 1)' : undefined,
      }}
    >
      {/* Tab strip */}
      <div
        ref={tabStripFrameRef}
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
                const prevIsEntering = Boolean(prevTab && enteringTabIdSet.has(prevTab.id));
                const isEnteringFromTab = enteringFromTabIdSet.has(tab.id);
                const prevIsEnteringFromTab = Boolean(prevTab && enteringFromTabIdSet.has(prevTab.id));
                const showDivider = idx > 0 && !isActiveTab && !prevIsActive;
                const isEnteringTab = enteringTabIdSet.has(tab.id);
                const isClosingTab = closingTabIdSet.has(tab.id);
                const prevIsClosing = Boolean(prevTab && closingTabIdSet.has(prevTab.id));
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
                        className={`editor-tab-divider self-center h-3.5 w-px shrink-0 bg-[var(--divider-subtle)] ${showSettledDivider ? 'opacity-100' : 'opacity-0'}`}
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
                      className={`group editor-tab ${isEnteringTab ? 'editor-tab-enter' : ''} ${isClosingTab ? 'editor-tab-exit' : ''} flex items-center gap-1.5 px-3 cursor-pointer transition-colors relative flex-none w-[var(--noa-tab-w)] ${
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
            className={`flex items-center justify-center w-6 h-6 ml-0.5 mb-[3px] rounded-md shrink-0 self-end transition-[background-color,color,transform] duration-200 ease-out active:scale-95 active:opacity-80 ${isDark ? 'text-[#F9F9F7]/30 hover:text-[#F9F9F7]/75 hover:bg-[#F9F9F7]/[0.07]' : 'text-[#2D2D2B]/35 hover:text-[#2D2D2B]/80 hover:bg-[#2D2D2B]/[0.05]'}`}
            style={noDragRegion}
            title="New tab"
            aria-label="New tab"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
