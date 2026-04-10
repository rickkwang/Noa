import React, { useEffect, useRef, useState } from 'react';
import { FileText, X, Eye, Edit2, Columns, Plus } from 'lucide-react';
import { Note } from '../../types';

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
  onTitleInputChange: (value: string) => void;
  onTitleSubmit: () => void;
  onTitleKeyDown: (e: React.KeyboardEvent) => void;
  onSetEditingTitle: (v: boolean) => void;
  onTabChange?: (id: string) => void;
  onTabClose?: (id: string) => void;
  onNewTab?: () => void;
  onClose?: () => void;
  setViewMode: (mode: 'edit' | 'preview' | 'split') => void;
  onExportMd: () => void;
  onExportHtml: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
}

export function EditorHeader({
  note,
  tabs,
  isEditingTitle,
  titleInput,
  viewMode,
  onTitleInputChange,
  onTitleSubmit,
  onTitleKeyDown,
  onSetEditingTitle,
  onTabChange,
  onTabClose,
  onNewTab,
  onClose,
  setViewMode,
  onExportMd,
  onExportHtml,
  titleInputRef,
}: EditorHeaderProps) {
  const isDark = useIsDarkLocal();
  const tabStripRef = useRef<HTMLDivElement>(null);
  const [hasOverflowLeft, setHasOverflowLeft] = useState(false);
  const [hasOverflowRight, setHasOverflowRight] = useState(false);

  useEffect(() => {
    const el = tabStripRef.current;
    if (!el) return;
    const syncOverflow = () => {
      const maxScrollLeft = el.scrollWidth - el.clientWidth;
      setHasOverflowLeft(el.scrollLeft > 0);
      setHasOverflowRight(maxScrollLeft > 1 && el.scrollLeft < maxScrollLeft - 1);
    };

    syncOverflow();
    el.addEventListener('scroll', syncOverflow, { passive: true });
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(el);
    window.addEventListener('resize', syncOverflow);

    return () => {
      el.removeEventListener('scroll', syncOverflow);
      observer.disconnect();
      window.removeEventListener('resize', syncOverflow);
    };
  }, [tabs, note.id]);

  return (
    <div className={`h-8 flex items-end justify-between shrink-0 z-10 font-redaction overflow-visible gap-2 pl-1 pr-2 relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:z-0 ${isDark ? 'bg-[#1E1E1C] after:bg-[#F0EDE6]/20' : 'bg-[#DCD9CE] after:bg-[#2D2D2D]'}`}>
      {/* Tab strip */}
      <div className="relative min-w-0 flex items-end overflow-x-auto overflow-y-visible [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {hasOverflowLeft && (
          <div className={`pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r z-10 ${isDark ? 'from-[#1E1E1C]' : 'from-[#DCD9CE]'} to-transparent`} />
        )}
        {hasOverflowRight && (
          <div className={`pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l z-10 ${isDark ? 'from-[#1E1E1C]' : 'from-[#DCD9CE]'} to-transparent`} />
        )}
        <div ref={tabStripRef} className="flex items-end pt-1">
          {tabs && tabs.length > 0 ? (
            tabs.map((tab, idx) => {
              const isActiveTab = tab.id === note.id;
              const prevTab = idx > 0 ? tabs[idx - 1] : null;
              const prevIsActive = prevTab?.id === note.id;
              const showDivider = idx > 0 && !isActiveTab && !prevIsActive;
              return (
                <React.Fragment key={tab.id}>
                  {showDivider && (
                    <div className={`self-center h-3.5 w-px shrink-0 ${isDark ? 'bg-[#F0EDE6]/15' : 'bg-[#2D2D2D]/20'}`} />
                  )}
                  <div
                    onClick={() => onTabChange?.(tab.id)}
                    className={`group flex items-center gap-1.5 px-3 cursor-pointer shrink-0 transition-colors relative ${
                      isActiveTab
                        ? `z-[1] pt-1 rounded-t-lg ${isDark ? 'bg-[#262624] text-[#F0EDE6]' : 'bg-[#EAE8E0] text-[#2D2D2D]'}`
                        : `bg-transparent border-transparent pt-1 ${isDark ? 'text-[#F0EDE6]/40 hover:text-[#F0EDE6]/70' : 'text-[#2D2D2D]/50 hover:text-[#2D2D2D]/80'}`
                    }`}
                    style={isActiveTab ? {
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: isDark ? 'rgba(240,237,230,0.2)' : '#2D2D2D',
                      borderBottomColor: 'transparent',
                      paddingBottom: '6px',
                    } : {
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: 'transparent',
                      paddingBottom: '6px',
                    }}
                  >
                    <FileText size={12} className={isActiveTab ? (isDark ? 'text-[#D97757] shrink-0' : 'text-[#B89B5E] shrink-0') : 'shrink-0'} />
                    {isActiveTab && isEditingTitle ? (
                      <input
                        ref={titleInputRef}
                        type="text"
                        value={titleInput}
                        onChange={(e) => onTitleInputChange(e.target.value)}
                        onBlur={onTitleSubmit}
                        onKeyDown={onTitleKeyDown}
                        className={`text-xs font-bold bg-transparent outline-none border-b w-28 min-w-0 ${isDark ? 'text-[#F0EDE6] border-[#D97757]' : 'text-[#2D2D2D] border-[#B89B5E]'}`}
                      />
                    ) : (
                      <span
                        className="text-xs font-bold truncate max-w-[120px]"
                        onDoubleClick={isActiveTab ? () => onSetEditingTitle(true) : undefined}
                        title={isActiveTab ? 'Double-click to rename' : tab.title}
                      >
                        {tab.title || 'Untitled'}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onTabClose?.(tab.id); }}
                      className={`shrink-0 opacity-0 group-hover:opacity-100 transition-all active:opacity-70 ${isDark ? 'text-[#F0EDE6]/30 hover:text-[#D97757]' : 'text-[#2D2D2D]/40 hover:text-red-500'}`}
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
                borderColor: isDark ? 'rgba(240,237,230,0.2)' : '#2D2D2D',
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
                  onBlur={onTitleSubmit}
                  onKeyDown={onTitleKeyDown}
                  className={`text-xs font-bold bg-transparent outline-none border-b w-28 shrink min-w-0 ${isDark ? 'text-[#F0EDE6] border-[#D97757]' : 'text-[#2D2D2D] border-[#B89B5E]'}`}
                />
              ) : (
                <span
                  className={`text-xs font-bold cursor-text truncate max-w-[120px] ${isDark ? 'text-[#F0EDE6]' : 'text-[#2D2D2D]'}`}
                  onClick={() => onSetEditingTitle(true)}
                  title="Click to rename"
                >
                  {note.title || 'Untitled'}
                </span>
              )}
              {onClose && (
                <button onClick={onClose} className={`shrink-0 transition-colors active:opacity-70 ${isDark ? 'text-[#F0EDE6]/30 hover:text-[#D97757]' : 'text-[#2D2D2D]/40 hover:text-red-500'}`}>
                  <X size={11} />
                </button>
              )}
            </div>
          )}
          {onNewTab && (
            <button
              onClick={onNewTab}
              className="flex items-center justify-center w-6 h-6 text-[#2D2D2D]/40 hover:text-[#2D2D2D] hover:bg-[#DCD9CE] active:opacity-70 rounded transition-colors shrink-0 self-end"
              title="New tab"
            >
              <Plus size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Right controls */}
      <div className={`flex items-center space-x-2 shrink-0 whitespace-nowrap self-center ${isDark ? 'text-[#F0EDE6]/50' : 'text-[#2D2D2D]/60'}`}>
        <div className={`flex items-center space-x-1 border-r pr-2 shrink-0 ${isDark ? 'border-[#F0EDE6]/10' : 'border-[#2D2D2D]/20'}`}>
          <button
            onClick={() => setViewMode('edit')}
            className={`p-1 active:opacity-70 transition-colors ${viewMode === 'edit' ? (isDark ? 'text-[#D97757]' : 'text-[#B89B5E]') : (isDark ? 'hover:text-[#D97757]' : 'hover:text-[#B89B5E]')}`}
            title="Edit Only"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`p-1 active:opacity-70 transition-colors ${viewMode === 'split' ? (isDark ? 'text-[#D97757]' : 'text-[#B89B5E]') : (isDark ? 'hover:text-[#D97757]' : 'hover:text-[#B89B5E]')}`}
            title="Split View"
          >
            <Columns size={14} />
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`p-1 active:opacity-70 transition-colors ${viewMode === 'preview' ? (isDark ? 'text-[#D97757]' : 'text-[#B89B5E]') : (isDark ? 'hover:text-[#D97757]' : 'hover:text-[#B89B5E]')}`}
            title="Preview Only"
          >
            <Eye size={14} />
          </button>
        </div>
        <div className="flex items-center space-x-2 text-xs shrink min-w-0 truncate">
          <span className="truncate">{new Date(note.updatedAt).toLocaleDateString()}</span>
          <span className="truncate">
            {new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className={`flex items-center space-x-1 border-l pl-2 shrink-0 ${isDark ? 'border-[#F0EDE6]/10' : 'border-[#2D2D2D]/20'}`}>
          <button
            onClick={onExportMd}
            className={`p-1 active:opacity-70 transition-colors text-xs ${isDark ? 'hover:text-[#D97757]' : 'hover:text-[#B89B5E]'}`}
            title="Export as Markdown"
          >
            .md
          </button>
          <button
            onClick={onExportHtml}
            className={`p-1 active:opacity-70 transition-colors text-xs ${isDark ? 'hover:text-[#D97757]' : 'hover:text-[#B89B5E]'}`}
            title="Export as HTML"
          >
            .html
          </button>
        </div>
      </div>
    </div>
  );
}
