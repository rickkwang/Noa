import React, { useEffect, useRef, useState } from 'react';
import { FileText, X, Eye, Edit2, Columns, Plus } from 'lucide-react';
import { Note } from '../../types';

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
    <div className="h-8 flex items-end justify-between shrink-0 bg-[#DCD9CE] z-10 font-redaction overflow-visible gap-2 pl-1 pr-2 relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-[#2D2D2D] after:z-0">
      {/* Tab strip */}
      <div className="relative min-w-0 flex items-end overflow-x-auto overflow-y-visible [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {hasOverflowLeft && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-[#DCD9CE] to-transparent z-10" />
        )}
        {hasOverflowRight && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-[#DCD9CE] to-transparent z-10" />
        )}
        <div ref={tabStripRef} className="flex items-end gap-0.5 pt-1">
          {tabs && tabs.length > 0 ? (
            tabs.map((tab) => {
              const isActiveTab = tab.id === note.id;
              return (
                <div
                  key={tab.id}
                  onClick={() => onTabChange?.(tab.id)}
                  className={`group flex items-center gap-1.5 px-3 cursor-pointer shrink-0 transition-colors relative ${
                    isActiveTab
                      ? 'bg-[#EAE8E0] text-[#2D2D2D] z-[1] pt-1 rounded-t-lg'
                      : 'bg-transparent border-transparent text-[#2D2D2D]/50 hover:text-[#2D2D2D]/80 pt-1 pb-1'
                  }`}
                  style={isActiveTab ? {
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: 'var(--border-primary, #2D2D2D)',
                    borderBottomColor: 'transparent',
                    paddingBottom: '6px',
                  } : {}}
                >
                  <FileText size={12} className={isActiveTab ? 'text-[#B89B5E] shrink-0' : 'shrink-0'} />
                  {isActiveTab && isEditingTitle ? (
                    <input
                      ref={titleInputRef}
                      type="text"
                      value={titleInput}
                      onChange={(e) => onTitleInputChange(e.target.value)}
                      onBlur={onTitleSubmit}
                      onKeyDown={onTitleKeyDown}
                      className="text-xs font-bold text-[#2D2D2D] bg-transparent outline-none border-b border-[#B89B5E] w-28 min-w-0"
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
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-[#2D2D2D]/40 hover:text-red-500 transition-all active:opacity-70"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })
          ) : (
            /* Fallback: single tab (legacy mode) */
            <div
              className="flex items-center gap-1.5 px-3 pt-1 rounded-t-lg bg-[#EAE8E0] relative z-[1] shrink-0"
              style={{
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: 'var(--border-primary, #2D2D2D)',
                borderBottomColor: 'transparent',
                paddingBottom: '6px',
              }}
            >
              <FileText size={12} className="text-[#B89B5E] shrink-0" />
              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={titleInput}
                  onChange={(e) => onTitleInputChange(e.target.value)}
                  onBlur={onTitleSubmit}
                  onKeyDown={onTitleKeyDown}
                  className="text-xs font-bold text-[#2D2D2D] bg-transparent outline-none border-b border-[#B89B5E] w-28 shrink min-w-0"
                />
              ) : (
                <span
                  className="text-xs font-bold text-[#2D2D2D] cursor-text truncate max-w-[120px]"
                  onClick={() => onSetEditingTitle(true)}
                  title="Click to rename"
                >
                  {note.title || 'Untitled'}
                </span>
              )}
              {onClose && (
                <button onClick={onClose} className="shrink-0 text-[#2D2D2D]/40 hover:text-red-500 transition-colors active:opacity-70">
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
      <div className="text-[#2D2D2D]/60 flex items-center space-x-2 shrink-0 whitespace-nowrap self-center">
        <div className="flex items-center space-x-1 border-r border-[#2D2D2D]/20 pr-2 shrink-0">
          <button
            onClick={() => setViewMode('edit')}
            className={`p-1 hover:text-[#B89B5E] active:opacity-70 transition-colors ${viewMode === 'edit' ? 'text-[#B89B5E]' : ''}`}
            title="Edit Only"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`p-1 hover:text-[#B89B5E] active:opacity-70 transition-colors ${viewMode === 'split' ? 'text-[#B89B5E]' : ''}`}
            title="Split View"
          >
            <Columns size={14} />
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`p-1 hover:text-[#B89B5E] active:opacity-70 transition-colors ${viewMode === 'preview' ? 'text-[#B89B5E]' : ''}`}
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
        <div className="flex items-center space-x-1 border-l border-[#2D2D2D]/20 pl-2 shrink-0">
          <button
            onClick={onExportMd}
            className="p-1 hover:text-[#B89B5E] active:opacity-70 transition-colors text-xs"
            title="Export as Markdown"
          >
            .md
          </button>
          <button
            onClick={onExportHtml}
            className="p-1 hover:text-[#B89B5E] active:opacity-70 transition-colors text-xs"
            title="Export as HTML"
          >
            .html
          </button>
        </div>
      </div>
    </div>
  );
}
