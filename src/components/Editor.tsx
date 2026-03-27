import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Note, AppSettings } from '../types';
import { FileText, X, Eye, Edit2, Columns, Bold, Italic, List, CheckSquare, Code, AlignLeft, Plus } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { useIsDark } from '../hooks/useIsDark';
import { exportNoteAsMd, exportNoteAsHtml, mdToHtml } from '../lib/export';
import { EditorView, keymap, ViewUpdate, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

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

// Dark theme for CodeMirror — warm dark palette matching the app's paper aesthetic
const darkTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: '#E8E0D0',
  },
  '.cm-content': {
    caretColor: '#E8E0D0',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    padding: '0',
  },
  '.cm-focused': { outline: 'none !important' },
  '&.cm-focused': { outline: 'none !important' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: '#E8E0D0' },
  '.cm-selectionBackground': { backgroundColor: '#B89B5E40' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: '#B89B5E60' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
  '.cm-placeholder': { color: '#9A908050' },
}, { dark: true });

const darkMarkdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: 'bold' },
  { tag: tags.heading2, fontSize: '1.3em', fontWeight: 'bold' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: 'bold' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'monospace', color: '#C9AA72', background: '#3D382820' },
  { tag: tags.link, color: '#C9AA72', textDecoration: 'underline' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.processingInstruction, tags.meta], color: '#9A908060' },
  { tag: tags.quote, fontStyle: 'italic', color: '#9A9080' },
]);

// Light theme for CodeMirror matching app style
const lightTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: '#2D2D2D',
  },
  '.cm-content': {
    caretColor: '#2D2D2D',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    padding: '0',
  },
  '.cm-focused': { outline: 'none !important' },
  '&.cm-focused': { outline: 'none !important' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: '#2D2D2D' },
  '.cm-selectionBackground': { backgroundColor: '#B89B5E40' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: '#B89B5E60' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
  '.cm-placeholder': { color: '#2D2D2D50' },
});

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: 'bold' },
  { tag: tags.heading2, fontSize: '1.3em', fontWeight: 'bold' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: 'bold' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'monospace', color: '#B89B5E', background: '#DCD9CE' },
  { tag: tags.link, color: '#B89B5E', textDecoration: 'underline' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.processingInstruction, tags.meta], color: '#2D2D2D40' },
  { tag: tags.quote, fontStyle: 'italic', color: '#2D2D2D80' },
]);

interface PreviewContentProps {
  note: Note;
  settings: AppSettings;
  onNavigateToNote: (title: string) => void;
  editorStyle: React.CSSProperties;
  contentMaxWidthStyle: React.CSSProperties;
}

function PreviewContent({ note, settings, onNavigateToNote, editorStyle, contentMaxWidthStyle }: PreviewContentProps) {
  const previewMarkdown = useMemo(
    () =>
      note.content.replace(/\[\[(.*?)\]\]/g, (_, title) => {
        const safeTitle = String(title ?? '').trim();
        const encoded = encodeURIComponent(safeTitle);
        return `[${safeTitle}](note-internal://${encoded})`;
      }),
    [note.content]
  );

  return (
    <div
      className="w-full h-full text-[#2D2D2D] prose prose-sm max-w-none prose-headings:font-bold prose-a:text-[#B89B5E] prose-a:no-underline hover:prose-a:underline prose-pre:bg-[#DCD9CE] prose-pre:text-[#2D2D2D] prose-pre:border prose-pre:border-[#2D2D2D] prose-code:text-[#B89B5E] prose-code:bg-[#DCD9CE]/50 prose-code:px-1 prose-code:rounded-sm"
      style={{ ...editorStyle, ...contentMaxWidthStyle }}
    >
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={{
          a: ({ href, children, ...props }) => {
            if (href?.startsWith('note-internal://')) {
              const encoded = href.replace('note-internal://', '');
              const noteTitle = decodeURIComponent(encoded);
              return (
                <span
                  className="text-[#B89B5E] cursor-pointer hover:underline font-bold"
                  onClick={() => onNavigateToNote(noteTitle)}
                >
                  {children}
                </span>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          }
        }}
      >
        {previewMarkdown}
      </Markdown>
    </div>
  );
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
  const [mentionQuery, setMentionQuery] = useState<{ query: string, index: number, x: number, y: number } | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [fadeIn, setFadeIn] = useState(true);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const editPaneRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const savedCursorRef = useRef<number>(0);
  const isDark = useIsDark(settings.appearance.theme);

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
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { chars, words };
  }, [note?.content]);

  useEffect(() => {
    if (note) {
      setFadeIn(false);
      const t = setTimeout(() => setFadeIn(true), 60);
      setTitleInput(note.title || 'Untitled');
      setMentionQuery(null);
      savedCursorRef.current = 0;
      return () => clearTimeout(t);
    }
  }, [note?.id]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Paste image support
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || viewMode === 'preview') return;

    const IMAGE_SIZE_LIMIT = 500 * 1024; // 500KB in bytes (base64 is ~4/3 of raw)

    const insertImage = (dataUrl: string) => {
      // base64 string size check: each base64 char = 0.75 bytes
      const base64 = dataUrl.split(',')[1] ?? '';
      const approxBytes = base64.length * 0.75;
      if (approxBytes > IMAGE_SIZE_LIMIT) {
        setImageError('Image exceeds 500KB limit. Please use a smaller image.');
        setTimeout(() => setImageError(null), 3000);
        return;
      }
      const imgMd = `![image](${dataUrl})`;
      const view = editorViewRef.current;
      if (view) {
        const { state } = view;
        const { from } = state.selection.main;
        view.dispatch({ changes: { from, insert: imgMd } });
      }
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
  }, [viewMode]);

  // Build CodeMirror instance
  useEffect(() => {
    if (!editorContainerRef.current) return;

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged) {
        const content = update.state.doc.toString();
        onUpdate(content);

        // Check for [[ trigger
        const cursor = update.state.selection.main.head;
        const textBefore = content.slice(0, cursor);
        const match = textBefore.match(/\[\[([^\]]*)$/);
        if (match) {
          const coords = update.view.coordsAtPos(cursor);
          const pane = editPaneRef.current;
          let x = 32, y = 32;
          if (coords && pane) {
            const rect = pane.getBoundingClientRect();
            x = Math.min(coords.left - rect.left, rect.width - 270);
            y = coords.bottom - rect.top + 4;
          }
          setMentionQuery({ query: match[1].toLowerCase(), index: match.index!, x, y });
        } else {
          setMentionQuery(null);
        }
      }
      // Always track cursor position so we can restore it after mode switch
      savedCursorRef.current = update.state.selection.main.head;
    });

    const insertMentionKeymap = keymap.of([
      {
        key: 'Tab',
        run: (view) => {
          const { state } = view;
          view.dispatch(state.replaceSelection('  '));
          return true;
        }
      }
    ]);

    const extensions = [
      markdown(),
      syntaxHighlighting(isDark ? darkMarkdownHighlightStyle : markdownHighlightStyle),
      updateListener,
      insertMentionKeymap,
      keymap.of([...defaultKeymap]),
      cmPlaceholder('Start typing...'),
      EditorView.lineWrapping,
      isDark ? darkTheme : lightTheme,
    ];

    const docContent = note?.content ?? '';
    const savedCursor = savedCursorRef.current;
    const cursorPos = Math.min(savedCursor, docContent.length);

    const state = EditorState.create({
      doc: docContent,
      extensions,
      selection: { anchor: cursorPos },
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    editorViewRef.current = view;

    return () => {
      // Save cursor before destroying
      savedCursorRef.current = view.state.selection.main.head;
      view.destroy();
      editorViewRef.current = null;
    };
    // Recreate only when note id or dark mode changes; viewMode excluded to preserve undo history
  }, [note?.id, isDark]);

  // Sync content from outside (e.g., task toggle) without destroying editor
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !note) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== note.content) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: note.content }
      });
    }
  }, [note?.content]);

  const insertFormatting = useCallback((before: string, after: string = '') => {
    const view = editorViewRef.current;
    if (!view) return;
    const { state } = view;
    const { from, to } = state.selection.main;
    const selected = state.doc.sliceString(from, to);
    view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
    });
    view.focus();
  }, []);

  const jumpToLine = useCallback((lineIndex: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    const line = view.state.doc.line(lineIndex + 1);
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  const insertMention = useCallback((title: string) => {
    const view = editorViewRef.current;
    if (!view || !mentionQuery) return;
    const { state } = view;
    const cursor = state.selection.main.head;
    const from = mentionQuery.index;
    view.dispatch({
      changes: { from, to: cursor, insert: `[[${title}]]` },
      selection: { anchor: from + title.length + 4 },
    });
    setMentionQuery(null);
    view.focus();
  }, [mentionQuery]);

  const tocHeadings = useMemo(() => {
    if (!note) return [];
    const lines = note.content.split('\n');
    const result: { level: number; text: string; lineIndex: number }[] = [];
    lines.forEach((line, i) => {
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (m) result.push({ level: m[1].length, text: m[2], lineIndex: i });
    });
    return result;
  }, [note?.content]);

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
              { key: '⌘ K', desc: 'Daily note' },
            ].map(({ key, desc }) => (
              <div key={key} className="flex items-center gap-3 text-sm text-[#2D2D2D]/60">
                <span className="border border-[#2D2D2D]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#2D2D2D]/50 tracking-wider min-w-[48px] text-center">{key}</span>
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

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (onRename && titleInput.trim() !== note.title) {
      onRename(titleInput.trim() || 'Untitled');
    } else {
      setTitleInput(note.title || 'Untitled');
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleTitleSubmit();
    else if (e.key === 'Escape') {
      setIsEditingTitle(false);
      setTitleInput(note.title || 'Untitled');
    }
  };

  const handleExportMd = () => exportNoteAsMd(note);
  const handleExportHtml = () => exportNoteAsHtml(note);

  const backlinks = allNotes.filter(n => n.links && n.links.includes(note.title) && n.id !== note.id);

  const getSnippet = (content: string, title: string) => {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(.{0,40})(\\[\\[${escapedTitle}\\]\\])(.{0,40})`, 'i');
    const match = content.match(regex);
    if (match) {
      return (
        <span>
          ...{match[1]}
          <span className="text-[#B89B5E] font-bold bg-[#B89B5E]/10 px-1 rounded">{match[2]}</span>
          {match[3]}...
        </span>
      );
    }
    return content.slice(0, 80) + '...';
  };

  const suggestedNotes = mentionQuery
    ? allNotes.filter(n => n.title.toLowerCase().includes(mentionQuery.query) && n.id !== note.id).slice(0, 5)
    : [];

  const editorStyle = {
    fontSize: `${settings.editor.fontSize}px`,
    lineHeight: settings.editor.lineHeight,
    fontFamily: settings.appearance.fontFamily === 'font-redaction' ? '"Redaction 50", serif' :
                settings.appearance.fontFamily === 'font-pixelify' ? '"Pixelify Sans", sans-serif' :
                settings.appearance.fontFamily === 'font-work-sans' ? '"Work Sans", sans-serif' :
                settings.appearance.fontFamily,
  };

  const containerClass = `flex-1 flex overflow-hidden z-10 relative ${
    settings.appearance.focusMode ? 'opacity-50 hover:opacity-100 transition-opacity duration-300' : ''
  }`;

  const contentMaxWidthStyle = { maxWidth: `${settings.appearance.maxWidth}px`, margin: '0 auto' };

  return (
    <div
      className="flex-1 flex flex-col min-w-0 bg-[#EAE8E0] relative"
      style={{ opacity: fadeIn ? 1 : 0, transition: 'opacity 120ms ease-in-out' }}
    >
      {/* Header — Tab bar, h-8 matches Sidebar/RightPanel header height */}
      <div className="h-8 border-b border-[#2D2D2D] flex items-end justify-between shrink-0 bg-[#DCD9CE] z-10 font-redaction overflow-hidden gap-2 pl-1 pr-2">
        {/* Tab strip */}
        <div className="flex items-end overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] gap-0.5 pt-1">
          {tabs && tabs.length > 0 ? (
            tabs.map((tab) => {
              const isActiveTab = tab.id === note?.id;
              return (
                <div
                  key={tab.id}
                  onClick={() => onTabChange?.(tab.id)}
                  className={`group flex items-center gap-1.5 px-3 py-1 cursor-pointer rounded-t-lg border border-b-0 shrink-0 transition-colors ${
                    isActiveTab
                      ? 'bg-[#EAE8E0] border-[#2D2D2D] text-[#2D2D2D] relative z-10'
                      : 'bg-[#DCD9CE]/60 border-[#2D2D2D]/30 text-[#2D2D2D]/50 hover:bg-[#DCD9CE] hover:text-[#2D2D2D]/80'
                  }`}
                  style={isActiveTab ? { marginBottom: '-1px' } : {}}
                >
                  <FileText size={12} className={isActiveTab ? 'text-[#B89B5E] shrink-0' : 'shrink-0'} />
                  {isActiveTab && isEditingTitle ? (
                    <input
                      ref={titleInputRef}
                      type="text"
                      value={titleInput}
                      onChange={(e) => setTitleInput(e.target.value)}
                      onBlur={handleTitleSubmit}
                      onKeyDown={handleTitleKeyDown}
                      className="text-xs font-bold text-[#2D2D2D] bg-transparent outline-none border-b border-[#B89B5E] w-28 min-w-0"
                    />
                  ) : (
                    <span
                      className="text-xs font-bold truncate max-w-[120px]"
                      onDoubleClick={isActiveTab ? () => setIsEditingTitle(true) : undefined}
                      title={isActiveTab ? 'Double-click to rename' : tab.title}
                    >
                      {tab.title || 'Untitled'}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onTabClose?.(tab.id); }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-[#2D2D2D]/40 hover:text-red-500 transition-all"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })
          ) : (
            /* Fallback: single tab (legacy mode) */
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-t-lg border border-b-0 border-[#2D2D2D] bg-[#EAE8E0] relative z-10 shrink-0" style={{ marginBottom: '-1px' }}>
              <FileText size={12} className="text-[#B89B5E] shrink-0" />
              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onBlur={handleTitleSubmit}
                  onKeyDown={handleTitleKeyDown}
                  className="text-xs font-bold text-[#2D2D2D] bg-transparent outline-none border-b border-[#B89B5E] w-28 shrink min-w-0"
                />
              ) : (
                <span
                  className="text-xs font-bold text-[#2D2D2D] cursor-text truncate max-w-[120px]"
                  onClick={() => setIsEditingTitle(true)}
                  title="Click to rename"
                >
                  {note.title || 'Untitled'}
                </span>
              )}
              {onClose && (
                <button onClick={onClose} className="shrink-0 text-[#2D2D2D]/40 hover:text-red-500 transition-colors">
                  <X size={11} />
                </button>
              )}
            </div>
          )}
          {/* + New tab button */}
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
        {/* Right controls */}
        <div className="text-[#2D2D2D]/60 flex items-center space-x-2 shrink-0 whitespace-nowrap self-center">
          <div className="flex items-center space-x-1 border-r border-[#2D2D2D]/20 pr-2 shrink-0">
            <button onClick={() => setViewMode('edit')} className={`p-1 hover:text-[#B89B5E] active:opacity-70 transition-colors ${viewMode === 'edit' ? 'text-[#B89B5E]' : ''}`} title="Edit Only">
              <Edit2 size={14} />
            </button>
            <button onClick={() => setViewMode('split')} className={`p-1 hover:text-[#B89B5E] active:opacity-70 transition-colors ${viewMode === 'split' ? 'text-[#B89B5E]' : ''}`} title="Split View">
              <Columns size={14} />
            </button>
            <button onClick={() => setViewMode('preview')} className={`p-1 hover:text-[#B89B5E] active:opacity-70 transition-colors ${viewMode === 'preview' ? 'text-[#B89B5E]' : ''}`} title="Preview Only">
              <Eye size={14} />
            </button>
          </div>
          <div className="flex items-center space-x-2 text-xs shrink min-w-0 truncate">
            <span className="truncate">{new Date(note.updatedAt).toLocaleDateString()}</span>
            <span className="truncate">{new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="flex items-center space-x-1 border-l border-[#2D2D2D]/20 pl-2 shrink-0">
            <button onClick={handleExportMd} className="p-1 hover:text-[#B89B5E] active:opacity-70 transition-colors text-xs" title="Export as Markdown">.md</button>
            <button onClick={handleExportHtml} className="p-1 hover:text-[#B89B5E] active:opacity-70 transition-colors text-xs" title="Export as HTML">.html</button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      {viewMode !== 'preview' && (
        <div className="h-8 border-b border-[#2D2D2D] flex items-center px-4 shrink-0 bg-[#EAE8E0] z-10 font-redaction space-x-2 text-[#2D2D2D]/70 relative overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <button onClick={() => insertFormatting('**', '**')} className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0" title="Bold"><Bold size={14} /></button>
          <button onClick={() => insertFormatting('*', '*')} className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0" title="Italic"><Italic size={14} /></button>
          <div className="w-px h-4 bg-[#2D2D2D]/20 mx-1 shrink-0" />
          <button onClick={() => insertFormatting('- ')} className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0" title="List"><List size={14} /></button>
          <button onClick={() => insertFormatting('- [ ] ')} className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0" title="Task List"><CheckSquare size={14} /></button>
          <div className="w-px h-4 bg-[#2D2D2D]/20 mx-1 shrink-0" />
          <button onClick={() => insertFormatting('`', '`')} className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0" title="Inline Code"><Code size={14} /></button>
          <button onClick={() => insertFormatting('\n```\n', '\n```\n')} className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors text-xs font-bold shrink-0" title="Code Block">{'</>'}</button>
          {tocHeadings.length > 0 && (
            <>
              <div className="w-px h-4 bg-[#2D2D2D]/20 mx-1 shrink-0" />
              <button
                onClick={() => setIsTocOpen(v => !v)}
                className={`p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0 ${isTocOpen ? 'text-[#B89B5E]' : ''}`}
                title="Outline"
              >
                <AlignLeft size={14} />
              </button>
            </>
          )}
        </div>
      )}

      {/* TOC Outline Panel */}
      {isTocOpen && tocHeadings.length > 0 && (
        <div className="absolute right-4 top-[68px] z-40 w-56 bg-[#EAE8E0] border-2 border-[#2D2D2D] shadow-[4px_4px_0px_0px_rgba(45,45,45,0.15)] font-redaction max-h-80 overflow-y-auto">
          <div className="px-3 py-1.5 bg-[#DCD9CE] border-b border-[#2D2D2D] text-xs font-bold uppercase tracking-wider text-[#2D2D2D]/70 flex items-center justify-between">
            <span>Outline</span>
            <button onClick={() => setIsTocOpen(false)} className="text-[#2D2D2D]/50 hover:text-[#2D2D2D]"><X size={12} /></button>
          </div>
          {tocHeadings.map((h, i) => (
            <button
              key={i}
              onClick={() => jumpToLine(h.lineIndex)}
              className="w-full text-left px-3 py-1 text-xs hover:bg-[#DCD9CE] text-[#2D2D2D] transition-colors truncate flex items-center"
              style={{ paddingLeft: `${(h.level - 1) * 10 + 12}px` }}
              title={h.text}
            >
              <span className="text-[#B89B5E] mr-1 shrink-0 font-bold" style={{ fontSize: '9px' }}>{'#'.repeat(h.level)}</span>
              <span className="truncate">{h.text}</span>
            </button>
          ))}
        </div>
      )}

      {/* Image error banner */}
      {imageError && (
        <div className="px-4 py-1.5 bg-red-50 border-b border-red-400 text-red-700 text-xs font-redaction flex items-center justify-between shrink-0 z-20">
          <span>{imageError}</span>
          <button onClick={() => setImageError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Workspace */}
      <div className={containerClass}>
        {/* Edit Pane (CodeMirror) — always mounted to preserve undo history */}
        <div
          ref={editPaneRef}
          className={`flex-1 p-8 overflow-y-auto relative ${viewMode === 'split' ? 'border-r border-[#2D2D2D] border-dashed' : ''}`}
          style={{ display: viewMode === 'preview' ? 'none' : undefined }}
        >
          <div className="h-full" style={{ ...contentMaxWidthStyle, ...editorStyle }}>
            <div ref={editorContainerRef} className="h-full" />
          </div>

          {/* Word Count */}
          <div className="absolute bottom-2 right-4 text-xs text-[#2D2D2D]/40 font-redaction pointer-events-none">
            {stats.words} words · {stats.chars} chars
          </div>

          {/* Auto-complete Dropdown */}
          {mentionQuery && suggestedNotes.length > 0 && (
            <div className="absolute z-50 bg-[#EAE8E0] border border-[#2D2D2D] shadow-[4px_4px_0_0_rgba(45,45,45,1)] font-redaction w-64 max-h-48 overflow-y-auto" style={{ top: mentionQuery.y, left: mentionQuery.x }}>
              <div className="px-3 py-1 bg-[#DCD9CE] border-b border-[#2D2D2D] text-xs font-bold text-[#2D2D2D]/70">
                Link to note
              </div>
              {suggestedNotes.map((n) => (
                <div
                  key={n.id}
                  className="px-3 py-2 hover:bg-[#2D2D2D] hover:text-[#EAE8E0] cursor-pointer border-b border-[#2D2D2D]/10 last:border-0 truncate"
                  onMouseDown={(e) => { e.preventDefault(); insertMention(n.title); }}
                >
                  {n.title}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview Pane */}
        {viewMode !== 'edit' && (
          <div className="flex-1 p-8 overflow-y-auto flex flex-col bg-[#EAE8E0]/50">
            <div className="flex-1">
              <PreviewContent
                note={note}
                settings={settings}
                onNavigateToNote={onNavigateToNote}
                editorStyle={editorStyle}
                contentMaxWidthStyle={contentMaxWidthStyle}
              />
            </div>

            {backlinks.length > 0 && (
              <div className="mt-12 pt-6 border-t border-[#2D2D2D] border-dashed font-redaction">
                <h3 className="text-sm font-bold text-[#2D2D2D]/70 mb-4 uppercase tracking-wider flex items-center">
                  <span className="bg-[#DCD9CE] px-2 py-1 mr-2">{backlinks.length}</span>
                  Linked Mentions
                </h3>
                <div className="space-y-3">
                  {backlinks.map(backlink => (
                    <div
                      key={backlink.id}
                      className="p-3 bg-[#DCD9CE]/30 border border-[#2D2D2D]/20 hover:border-[#B89B5E] cursor-pointer transition-colors group"
                      onClick={() => onNavigateToNote(backlink.title)}
                    >
                      <div className="font-bold text-[#2D2D2D] group-hover:text-[#B89B5E] mb-2 transition-colors">
                        {backlink.title}
                      </div>
                      <div className="text-xs text-[#2D2D2D]/70 leading-relaxed break-words">
                        {getSnippet(backlink.content, note.title)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
