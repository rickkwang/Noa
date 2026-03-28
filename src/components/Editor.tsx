import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Note, AppSettings } from '../types';
import { useIsDark } from '../hooks/useIsDark';
import { exportNoteAsMd, exportNoteAsHtml } from '../lib/export';
import { useCodeMirror } from './editor/useCodeMirror';
import { EditorHeader } from './editor/EditorHeader';
import { EditorToolbar } from './editor/EditorToolbar';
import { TocPanel } from './editor/TocPanel';
import { PreviewPane } from './editor/PreviewPane';
import { MentionDropdown } from './editor/MentionDropdown';

interface EditorTab {
  id: string;
  title: string;
}

interface EditorProps {
  note?: Note;
  allNotes: Note[];
  onUpdate: (content: string) => void;
  onRename?: (title: string) => void;
  onClose?: () => void;
  onNavigateToNote: (title: string) => void;
  viewMode: 'edit' | 'preview' | 'split';
  setViewMode: (mode: 'edit' | 'preview' | 'split') => void;
  settings: AppSettings;
  tabs?: EditorTab[];
  onTabChange?: (id: string) => void;
  onTabClose?: (id: string) => void;
  onNewTab?: () => void;
}

export default function Editor({
  note,
  allNotes,
  onUpdate,
  onRename,
  onClose,
  onNavigateToNote,
  viewMode,
  setViewMode,
  settings,
  tabs,
  onTabChange,
  onTabClose,
  onNewTab,
}: EditorProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [mentionQuery, setMentionQuery] = useState<{ query: string; index: number; x: number; y: number } | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [fadeIn, setFadeIn] = useState(true);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const editPaneRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDark(settings.appearance.theme);

  const { insertFormatting, jumpToLine, insertMention } = useCodeMirror({
    containerRef: editorContainerRef,
    note,
    isDark,
    onUpdate,
    onMentionTrigger: setMentionQuery,
    editPaneRef,
  });

  // Inject highlight.js theme
  useEffect(() => {
    const id = 'hljs-theme';
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = isDark
      ? new URL('highlight.js/styles/github-dark.css', import.meta.url).href
      : new URL('highlight.js/styles/github.css', import.meta.url).href;
  }, [isDark]);

  const stats = useMemo(() => {
    const text = note?.content ?? '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { chars: text.length, words };
  }, [note?.content]);

  useEffect(() => {
    if (note) {
      setFadeIn(false);
      const t = setTimeout(() => setFadeIn(true), 60);
      setTitleInput(note.title || 'Untitled');
      setMentionQuery(null);
      return () => clearTimeout(t);
    }
  }, [note?.id]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Paste/drop image support
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || viewMode === 'preview') return;

    const IMAGE_SIZE_LIMIT = 500 * 1024;

    const insertImage = (dataUrl: string) => {
      const base64 = dataUrl.split(',')[1] ?? '';
      if (base64.length * 0.75 > IMAGE_SIZE_LIMIT) {
        setImageError('Image exceeds 500KB limit. Please use a smaller image.');
        setTimeout(() => setImageError(null), 3000);
        return;
      }
      insertFormatting(`![image](${dataUrl})`);
    };

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = (ev) => insertImage(ev.target?.result as string);
          reader.readAsDataURL(file);
        }
      }
    };

    const handleDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        if (file.type.startsWith('image/')) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = (ev) => insertImage(ev.target?.result as string);
          reader.readAsDataURL(file);
        }
      }
    };

    container.addEventListener('paste', handlePaste);
    container.addEventListener('drop', handleDrop);
    return () => {
      container.removeEventListener('paste', handlePaste);
      container.removeEventListener('drop', handleDrop);
    };
  }, [viewMode, insertFormatting]);

  const tocHeadings = useMemo(() => {
    if (!note) return [];
    return note.content.split('\n').reduce<{ level: number; text: string; lineIndex: number }[]>(
      (acc, line, i) => {
        const m = line.match(/^(#{1,6})\s+(.+)$/);
        if (m) acc.push({ level: m[1].length, text: m[2], lineIndex: i });
        return acc;
      },
      []
    );
  }, [note?.content]);

  const handleTitleSubmit = useCallback(() => {
    setIsEditingTitle(false);
    if (onRename && note && titleInput.trim() !== note.title) {
      onRename(titleInput.trim() || 'Untitled');
    } else if (note) {
      setTitleInput(note.title || 'Untitled');
    }
  }, [onRename, note, titleInput]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleTitleSubmit();
    else if (e.key === 'Escape') {
      setIsEditingTitle(false);
      setTitleInput(note?.title || 'Untitled');
    }
  }, [handleTitleSubmit, note?.title]);

  const editorStyle: React.CSSProperties = {
    fontSize: `${settings.editor.fontSize}px`,
    lineHeight: settings.editor.lineHeight,
    fontFamily:
      settings.appearance.fontFamily === 'font-redaction' ? '"Redaction 50", serif' :
      settings.appearance.fontFamily === 'font-pixelify' ? '"Pixelify Sans", sans-serif' :
      settings.appearance.fontFamily === 'font-work-sans' ? '"Work Sans", sans-serif' :
      settings.appearance.fontFamily,
  };

  const contentMaxWidthStyle: React.CSSProperties = {
    maxWidth: `${settings.appearance.maxWidth}px`,
    margin: '0 auto',
  };

  if (!note) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#EAE8E0] font-redaction select-none px-8">
        <div className="border border-[#2D2D2D]/15 bg-[#DCD9CE]/40 p-8 max-w-md w-full">
          <div className="text-2xl font-bold text-[#2D2D2D] tracking-wide mb-1">Noa</div>
          <div className="text-xs text-[#2D2D2D]/40 uppercase tracking-widest mb-6">Your private writing space</div>
          <div className="space-y-2 mb-8">
            {[
              { key: '⌘ N', desc: 'New note' },
              { key: '⌘ F', desc: 'Search notes' },
              { key: '⌘ K', desc: 'Command palette' },
            ].map(({ key, desc }) => (
              <div key={key} className="flex items-center gap-3 text-sm text-[#2D2D2D]/60">
                <span className="border border-[#2D2D2D]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#2D2D2D]/50 tracking-wider min-w-[48px] text-center">
                  {key}
                </span>
                <span>{desc}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-[#2D2D2D]/10 pt-4 text-[10px] text-[#2D2D2D]/35 leading-relaxed">
            All notes are stored locally in your browser. Export regularly to avoid data loss.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col min-w-0 bg-[#EAE8E0] relative"
      style={{ opacity: fadeIn ? 1 : 0, transition: 'opacity 120ms ease-in-out' }}
    >
      <EditorHeader
        note={note}
        tabs={tabs}
        isEditingTitle={isEditingTitle}
        titleInput={titleInput}
        viewMode={viewMode}
        onTitleInputChange={setTitleInput}
        onTitleSubmit={handleTitleSubmit}
        onTitleKeyDown={handleTitleKeyDown}
        onSetEditingTitle={setIsEditingTitle}
        onTabChange={onTabChange}
        onTabClose={onTabClose}
        onNewTab={onNewTab}
        onClose={onClose}
        setViewMode={setViewMode}
        onExportMd={() => exportNoteAsMd(note)}
        onExportHtml={() => exportNoteAsHtml(note)}
        titleInputRef={titleInputRef}
      />

      {viewMode !== 'preview' && (
        <EditorToolbar
          onInsertFormatting={insertFormatting}
          hasToc={tocHeadings.length > 0}
          isTocOpen={isTocOpen}
          onToggleToc={() => setIsTocOpen((v) => !v)}
        />
      )}

      {isTocOpen && (
        <TocPanel
          headings={tocHeadings}
          onJumpToLine={jumpToLine}
          onClose={() => setIsTocOpen(false)}
        />
      )}

      {imageError && (
        <div className="px-4 py-1.5 bg-red-50 border-b border-red-400 text-red-700 text-xs font-redaction flex items-center justify-between shrink-0 z-20">
          <span>{imageError}</span>
          <button onClick={() => setImageError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <div
        className={`flex-1 flex overflow-hidden z-10 relative ${
          settings.appearance.focusMode ? 'opacity-50 hover:opacity-100 transition-opacity duration-300' : ''
        }`}
      >
        {/* Edit Pane — always mounted to preserve undo history */}
        <div
          ref={editPaneRef}
          className={`flex-1 p-8 overflow-y-auto relative ${viewMode === 'split' ? 'border-r border-[#2D2D2D] border-dashed' : ''}`}
          style={{ display: viewMode === 'preview' ? 'none' : undefined }}
        >
          <div className="h-full" style={{ ...contentMaxWidthStyle, ...editorStyle }}>
            <div ref={editorContainerRef} className="h-full" />
          </div>

          <div className="absolute bottom-2 right-4 text-xs text-[#2D2D2D]/40 font-redaction pointer-events-none">
            {stats.words} words · {stats.chars} chars
          </div>

          {mentionQuery && (
            <MentionDropdown
              mentionQuery={mentionQuery}
              allNotes={allNotes}
              currentNoteId={note.id}
              onInsert={(title, index) => {
                insertMention(title, index);
                setMentionQuery(null);
              }}
            />
          )}
        </div>

        {viewMode !== 'edit' && (
          <PreviewPane
            note={note}
            allNotes={allNotes}
            settings={settings}
            onNavigateToNote={onNavigateToNote}
            editorStyle={editorStyle}
            contentMaxWidthStyle={contentMaxWidthStyle}
          />
        )}
      </div>
    </div>
  );
}
