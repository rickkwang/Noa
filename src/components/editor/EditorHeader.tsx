import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText, X, Eye, Edit2, Columns, Plus, History, Download } from '@/src/lib/icons';
import { Note } from '../../types';

function ExportMenu({ isDark, onExportMd, onExportHtml }: { isDark: boolean; onExportMd: () => void; onExportHtml: () => void }) {
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
        className={`flex items-center p-1.5 active:opacity-70 transition-colors ${open ? (isDark ? 'text-[#D97757]' : 'text-[#B89B5E]') : (isDark ? 'hover:text-[#D97757]' : 'hover:text-[#B89B5E]')}`}
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

function useIsDarkLocal(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const obs = new MutationObserver(() => setIsDark(document.documentElement.dataset.theme === 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
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
  onTitleInputChange: (value: string) => void;
  onTitleSubmit: () => void;
  onTitleKeyDown: (e: React.KeyboardEvent) => void;
  onSetEditingTitle: (v: boolean) => void;
  onTabChange?: (id: string) => void;
  onTabClose?: (id: string) => void;
  onNewTab?: () => void;
  onTabEnterComplete?: (id: string) => void;
  onClose?: () => void;
  setViewMode: (mode: 'edit' | 'preview' | 'split') => void;
  onExportMd: () => void;
  onExportHtml: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  onToggleHistory?: () => void;
  isHistoryOpen?: boolean;
}

export function EditorHeader({
  note,
  tabs,
  isEditingTitle,
  titleInput,
  viewMode,
  enteringTabId,
  onTitleInputChange,
  onTitleSubmit,
  onTitleKeyDown,
  onSetEditingTitle,
  onTabChange,
  onTabClose,
  onNewTab,
  onTabEnterComplete,
  onClose,
  setViewMode,
  onExportMd,
  onExportHtml,
  titleInputRef,
  onToggleHistory,
  isHistoryOpen,
}: EditorHeaderProps) {
  const isDark = useIsDarkLocal();
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

  useLayoutEffect(() => {
    const scrollEl = tabStripRef.current;
    if (!scrollEl) return;
    // Keep the active tab in view when it changes (e.g. activated via keyboard or
    // sidebar while scrolled off-screen).
    const active = scrollEl.querySelector<HTMLElement>('[data-active-tab="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [tabs, note.id]);

  useEffect(() => {
    if (!enteringTabId || !shouldAnimateEnteringTab) return;
    const timeout = window.setTimeout(() => {
      onTabEnterComplete?.(enteringTabId);
    }, 210);
    return () => window.clearTimeout(timeout);
  }, [enteringTabId, onTabEnterComplete, shouldAnimateEnteringTab]);

  return (
    <div className={`h-8 flex items-end justify-between shrink-0 z-10 font-redaction overflow-visible gap-2 pl-1 pr-2 relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:z-0 ${isDark ? 'bg-[#1E1E1C] after:bg-[#EEEDEA]/15' : 'bg-[#DCD9CE] after:bg-[#2D2D2D]'}`}>
      {/* Tab strip */}
      <div className="relative min-w-0 flex-1 flex items-end overflow-visible">
        <div
          ref={tabStripRef}
          className="min-w-0 flex-1 flex items-end overflow-x-auto overflow-y-visible [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          style={{ scrollPaddingInline: '10px' }}
        >
          <div className="flex items-end pt-1 w-full">
            {tabs && tabs.length > 0 ? (
              tabs.map((tab, idx) => {
                const isActiveTab = tab.id === note.id;
                const prevTab = idx > 0 ? tabs[idx - 1] : null;
                const prevIsActive = prevTab?.id === note.id;
                const showDivider = idx > 0 && !isActiveTab && !prevIsActive;
                const isEnteringTab = shouldAnimateEnteringTab && enteringTabId === tab.id;
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
                      <div className={`self-center h-3.5 w-px shrink-0 ${showDivider ? (isDark ? 'bg-[#EEEDEA]/15' : 'bg-[#2D2D2D]/20') : 'bg-transparent'}`} />
                    )}
                    <div
                      data-tab-id={tab.id}
                      data-active-tab={isActiveTab}
                      onClick={() => onTabChange?.(tab.id)}
                      className={`group editor-tab ${isEnteringTab ? 'editor-tab-enter' : ''} flex items-center gap-1.5 px-3 cursor-pointer transition-colors relative flex-1 min-w-[4.5rem] max-w-[9rem] ${
                        isActiveTab
                          ? `z-[1] pt-1 rounded-t-lg ${isDark ? 'bg-[#262624] text-[#EEEDEA]' : 'bg-[#EAE8E0] text-[#2D2D2D]'}`
                          : `bg-transparent border-transparent pt-1 ${isDark ? 'text-[#EEEDEA]/40 hover:text-[#EEEDEA]/70' : 'text-[#2D2D2D]/50 hover:text-[#2D2D2D]/80'}`
                      }`}
                      style={tabStyle}
                    >
                      <FileText size={12} className={isActiveTab ? (isDark ? 'text-[#D97757] shrink-0' : 'text-[#B89B5E] shrink-0') : 'shrink-0'} />
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
                          className={`text-xs font-bold bg-transparent outline-none border-b w-28 min-w-0 ${isDark ? 'text-[#EEEDEA] border-[#D97757]' : 'text-[#2D2D2D] border-[#B89B5E]'}`}
                        />
                      ) : (
                        <span
                          className="text-xs font-bold truncate min-w-0 flex-1"
                          onDoubleClick={isActiveTab ? () => onSetEditingTitle(true) : undefined}
                          title={isActiveTab ? 'Double-click to rename' : tab.title}
                        >
                          {tab.title || 'Untitled'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onTabClose?.(tab.id); }}
                        className={`shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity active:opacity-70 ${isDark ? 'text-[#EEEDEA]/30 hover:text-[#D97757]' : 'text-[#2D2D2D]/40 hover:text-red-500'}`}
                        aria-label={`Close ${tab.title || 'Untitled'} tab`}
                        title={`Close ${tab.title || 'Untitled'} tab`}
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
                <FileText size={12} className={isDark ? 'text-[#D97757] shrink-0' : 'text-[#B89B5E] shrink-0'} />
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
                    className={`text-xs font-bold bg-transparent outline-none border-b w-28 shrink min-w-0 ${isDark ? 'text-[#EEEDEA] border-[#D97757]' : 'text-[#2D2D2D] border-[#B89B5E]'}`}
                  />
                ) : (
                  <span
                    className={`text-xs font-bold cursor-text truncate max-w-[120px] ${isDark ? 'text-[#EEEDEA]' : 'text-[#2D2D2D]'}`}
                    onClick={() => onSetEditingTitle(true)}
                    title="Click to rename"
                  >
                    {note.title || 'Untitled'}
                  </span>
                )}
                {onClose && (
                  <button onClick={onClose} className={`shrink-0 transition-colors active:opacity-70 ${isDark ? 'text-[#EEEDEA]/30 hover:text-[#D97757]' : 'text-[#2D2D2D]/40 hover:text-red-500'}`}>
                    <X size={11} />
                  </button>
                )}
              </div>
            )}
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
        </div>
      </div>

      {/* Right controls */}
      <div className={`flex items-center gap-3 shrink-0 whitespace-nowrap self-center px-1 ${isDark ? 'text-[#EEEDEA]/50' : 'text-[#2D2D2D]/60'}`}>
        {/* Group 1: view modes */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setViewMode('edit')}
            className={`p-1.5 rounded-md active:opacity-70 transition-colors ${viewMode === 'edit' ? (isDark ? 'text-[#D97757] bg-[#D97757]/15' : 'text-[#B89B5E] bg-[#B89B5E]/15') : (isDark ? 'hover:text-[#D97757]' : 'hover:text-[#B89B5E]')}`}
            title="Edit Only"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`p-1.5 rounded-md active:opacity-70 transition-colors ${viewMode === 'split' ? (isDark ? 'text-[#D97757] bg-[#D97757]/15' : 'text-[#B89B5E] bg-[#B89B5E]/15') : (isDark ? 'hover:text-[#D97757]' : 'hover:text-[#B89B5E]')}`}
            title="Split View"
          >
            <Columns size={14} />
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`p-1.5 rounded-md active:opacity-70 transition-colors ${viewMode === 'preview' ? (isDark ? 'text-[#D97757] bg-[#D97757]/15' : 'text-[#B89B5E] bg-[#B89B5E]/15') : (isDark ? 'hover:text-[#D97757]' : 'hover:text-[#B89B5E]')}`}
            title="Preview Only"
          >
            <Eye size={14} />
          </button>
        </div>

        <div className={`self-stretch w-px shrink-0 my-1.5 ${isDark ? 'bg-[#EEEDEA]/10' : 'bg-[#2D2D2D]/20'}`} />

        {/* Group 2: actions */}
        <div className="flex items-center gap-1 shrink-0">
          <ExportMenu isDark={isDark} onExportMd={onExportMd} onExportHtml={onExportHtml} />
          {onToggleHistory && (
            <button
              onClick={onToggleHistory}
              className={`p-1.5 rounded-md active:opacity-70 transition-colors shrink-0 ${isHistoryOpen ? (isDark ? 'text-[#D97757] bg-[#D97757]/15' : 'text-[#B89B5E] bg-[#B89B5E]/15') : (isDark ? 'hover:text-[#D97757]' : 'hover:text-[#B89B5E]')}`}
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
