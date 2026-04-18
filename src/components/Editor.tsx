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
import { SlashCommandDropdown, SLASH_COMMANDS, type SlashCommand } from './editor/SlashCommandDropdown';
import { AttachmentPanel } from './editor/AttachmentPanel';
import { HistoryPanel } from './editor/HistoryPanel';
import { FindReplacePanel } from './editor/FindReplacePanel';
import { useScrollingClass } from '../hooks/useScrollingClass';
import { useAttachments } from '../hooks/useAttachments';
import { NoteSnapshot } from '../types';

const ATTACHMENT_PASTE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

interface EditorTab {
  id: string;
  title: string;
}

interface EditorProps {
  note?: Note;
  allNotes: Note[];
  onUpdate: (content: string) => void;
  onNoteUpdate?: (note: Note) => void;
  onRename?: (title: string) => void;
  onClose?: () => void;
  onNavigateToNoteLegacy: (title: string) => void;
  onNavigateToNoteById: (id: string) => void;
  onRestoreSnapshot?: (snapshot: NoteSnapshot) => Promise<void>;
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
  onNoteUpdate,
  onRename,
  onClose,
  onNavigateToNoteLegacy,
  onNavigateToNoteById,
  viewMode,
  setViewMode,
  settings,
  tabs,
  onTabChange,
  onTabClose,
  onNewTab,
  onRestoreSnapshot,
}: EditorProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [mentionQuery, setMentionQuery] = useState<{ query: string; index: number; x: number; y: number } | null>(null);
  const [slashQuery, setSlashQuery] = useState<{ query: string; index: number; x: number; y: number } | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const container = splitContainerRef.current;
    if (!container) return;
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const rect = container.getBoundingClientRect();
      const ratio = Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0.2), 0.8);
      setSplitRatio(ratio);
    };
    const cleanup = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', cleanup);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', cleanup);
  }, []);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const editPaneRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDark(settings.appearance.theme);

  const handleNoteUpdate = useCallback((updated: Note) => {
    onNoteUpdate?.(updated);
  }, [onNoteUpdate]);

  const { objectUrls, uploadFile, deleteAttachment, attachmentLoadError } = useAttachments(
    note ?? null,
    handleNoteUpdate
  );

  useScrollingClass(editorContainerRef, { capture: true, filterClass: 'cm-scroller' });

  const { editorViewRef, insertFormatting, jumpToLine, insertMention, insertSlashCommand } = useCodeMirror({
    containerRef: editorContainerRef,
    maxWidth: settings.appearance.maxWidth,
    note,
    isDark,
    onUpdate,
    onMentionTrigger: setMentionQuery,
    onSlashTrigger: setSlashQuery,
    editPaneRef,
  });

  // ⌘F / Ctrl+F opens Find & Replace when the editor is focused
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || viewMode === 'preview') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && !e.shiftKey) {
        e.preventDefault();
        setIsFindReplaceOpen(true);
      }
    };
    container.addEventListener('keydown', handleKeyDown, true);
    return () => container.removeEventListener('keydown', handleKeyDown, true);
  }, [viewMode]);

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

  useEffect(() => {
    const id = 'noa-hljs-overrides';
    let style = document.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = `
      .hljs-addition, .hljs-deletion { background-color: transparent !important; }
    `;
  }, []);

  const stats = useMemo(() => {
    const text = note?.content ?? '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { chars: text.length, words };
  }, [note?.content]);

  useEffect(() => {
    // Reset transient UI state whenever the active note changes — including when
    // it becomes undefined (e.g. the note was deleted in another tab). Leaving
    // stale titleInput / dropdowns visible misleads the user into thinking they
    // are still editing the previous note.
    setTitleInput(note?.title || '');
    setMentionQuery(null);
    setSlashQuery(null);
    setIsHistoryOpen(false);
    setIsFindReplaceOpen(false);
    setIsEditingTitle(false);
    setImageError(null);
  }, [note?.id]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Paste/drop file support (images only → attachment system)
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || viewMode === 'preview') return;

    const handleFiles = async (files: File[]) => {
      for (const file of files) {
        if (!ATTACHMENT_PASTE_TYPES.has(file.type)) continue;
        if (onNoteUpdate) {
          // Use attachment system
          const err = await uploadFile(file);
          if (err) {
            const errorMessages: Record<string, string> = {
              size_exceeded: 'File exceeds 10MB limit',
              storage_full: 'Storage is almost full, please free up space',
              type_not_allowed: 'Unsupported file type',
              upload_failed: 'Upload failed',
            };
            setImageError(errorMessages[err] ?? 'Upload failed');
            setTimeout(() => setImageError(null), 3000);
          } else {
            // Insert reference syntax
            const syntax = `![[${file.name}]]`;
            insertFormatting(syntax);
          }
        } else if (file.type.startsWith('image/')) {
          // Fallback: base64 embed (legacy, no onNoteUpdate)
          const IMAGE_SIZE_LIMIT = 500 * 1024;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target?.result as string;
            const base64 = dataUrl.split(',')[1] ?? '';
            if (base64.length * 0.75 > IMAGE_SIZE_LIMIT) {
              setImageError('Image exceeds 500KB limit. Please use a smaller image.');
              setTimeout(() => setImageError(null), 3000);
              return;
            }
            insertFormatting(`![image](${dataUrl})`);
          };
          reader.readAsDataURL(file);
        }
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (ATTACHMENT_PASTE_TYPES.has(item.type)) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length) { e.preventDefault(); handleFiles(files); }
    };

    const handleDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files) return;
      const filtered = Array.from(files).filter(f => ATTACHMENT_PASTE_TYPES.has(f.type));
      if (filtered.length) { e.preventDefault(); handleFiles(filtered); }
    };

    container.addEventListener('paste', handlePaste);
    container.addEventListener('drop', handleDrop);
    return () => {
      container.removeEventListener('paste', handlePaste);
      container.removeEventListener('drop', handleDrop);
    };
  }, [viewMode, insertFormatting, onNoteUpdate, uploadFile]);

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
      <div className="flex-1 flex flex-col items-center justify-center bg-[#EAE8E0] font-redaction select-none">
        <div className="flex flex-col gap-8 w-56">
          {/* Wordmark */}
          <div className="flex flex-col gap-1">
            <div className="text-4xl font-bold text-[#2D2D2D]/75 tracking-tight">Noa</div>
            <div className="text-[10px] text-[#2D2D2D]/30 uppercase tracking-widest">your private writing space</div>
          </div>

          {/* Shortcuts */}
          <div className="flex flex-col gap-2.5">
            {[
              { key: '⌘N', desc: 'New note' },
              { key: '⌘F', desc: 'Search notes' },
              { key: '⌘K', desc: 'Command palette' },
            ].map(({ key, desc }) => (
              <div key={key} className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-[#B89B5E]/60 tracking-widest w-7">{key}</span>
                <span className="text-[#2D2D2D]/15">·</span>
                <span className="text-xs text-[#2D2D2D]/40">{desc}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="text-[10px] text-[#2D2D2D]/20 tracking-wide">
            Notes stored locally · Export regularly
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col min-w-0 bg-[#EAE8E0] relative"
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
        onToggleHistory={onRestoreSnapshot ? () => setIsHistoryOpen(v => !v) : undefined}
        isHistoryOpen={isHistoryOpen}
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

      {isFindReplaceOpen && viewMode !== 'preview' && (
        <FindReplacePanel
          editorViewRef={editorViewRef}
          isDark={isDark}
          onClose={() => setIsFindReplaceOpen(false)}
        />
      )}

      {(imageError || attachmentLoadError) && (
        <div className="px-4 py-1.5 bg-red-50 border-b border-red-400 text-red-700 text-xs font-redaction flex items-center justify-between shrink-0 z-20">
          <span>{imageError || attachmentLoadError}</span>
          <button onClick={() => setImageError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <div
        ref={splitContainerRef}
        className="flex-1 flex overflow-hidden z-10 relative"
      >
        {isHistoryOpen && onRestoreSnapshot && (
          <HistoryPanel
            noteId={note.id}
            isDark={isDark}
            onRestore={async (snapshot) => {
              await onRestoreSnapshot(snapshot);
              setIsHistoryOpen(false);
            }}
            onClose={() => setIsHistoryOpen(false)}
          />
        )}
        {/* Edit Pane — always mounted to preserve undo history */}
        <div
          ref={editPaneRef}
          className="overflow-y-auto relative"
          style={{
            display: viewMode === 'preview' ? 'none' : undefined,
            width: viewMode === 'split' ? `${splitRatio * 100}%` : undefined,
            flex: viewMode === 'split' ? 'none' : '1',
            padding: '2rem 0 2rem 2rem',
          }}
        >
          <div className="h-full" style={editorStyle}>
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
          {slashQuery && (
            <SlashCommandDropdown
              slashQuery={slashQuery}
              onInsert={(cmd: SlashCommand, index: number) => {
                insertSlashCommand(cmd.insert, index);
                setSlashQuery(null);
              }}
              onDismiss={() => setSlashQuery(null)}
            />
          )}
        </div>

        {viewMode === 'split' && (
          <div
            className="w-px bg-[#2D2D2D]/20 cursor-col-resize hover:bg-[#B89B5E]/60 transition-colors shrink-0 select-none"
            onMouseDown={handleDividerMouseDown}
          />
        )}

        {viewMode !== 'edit' && (
          <PreviewPane
            note={note}
            allNotes={allNotes}
            settings={settings}
            onNavigateToNoteLegacy={onNavigateToNoteLegacy}
            onNavigateToNoteById={onNavigateToNoteById}
            editorStyle={editorStyle}
            contentMaxWidthStyle={contentMaxWidthStyle}
            objectUrls={objectUrls}
            style={viewMode === 'split' ? { width: `${(1 - splitRatio) * 100}%`, flex: 'none' } : undefined}
          />
        )}
      </div>

      {onNoteUpdate && (
        <AttachmentPanel
          attachments={note.attachments ?? []}
          onUpload={uploadFile}
          onDelete={deleteAttachment}
          onInsertReference={(filename, mimeType) => {
            const syntax = `![[${filename}]]`;
            insertFormatting(syntax);
          }}
        />
      )}
    </div>
  );
}
