import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { TITLEBAR_NOTE_ACTIONS_SLOT_ID } from '../constants/rightTabs';
import { useAttachments } from '../hooks/useAttachments';
import { useIsDark } from '../hooks/useIsDark';
import { useNoteProperties } from '../hooks/useNoteProperties';
import { findNoteAttachment } from '../lib/attachmentUtils';
import { exportNoteAsMd, exportNoteAsHtml } from '../lib/export';
import { resolveFontFamily } from '../lib/fontFamily';
import { buildLinkIndex, parseMarkdownLinkAnchor, parseMarkdownLinkTarget, resolveLinkTarget, scanHeadings } from '../lib/noteUtils';
import { Note, Folder, AppSettings, NoteSnapshot } from '../types';
import { AttachmentPanel } from './editor/AttachmentPanel';
import { bodyCaretTarget } from './editor/bodyCaret';
import { EditorActions } from './editor/EditorActions';
import { EditorHeader } from './editor/EditorHeader';
import { FindReplacePanel } from './editor/FindReplacePanel';
import { HistoryPanel } from './editor/HistoryPanel';
import { remeasureTitle } from './editor/inlineTitle';
import { type OpenableLink } from './editor/livePreview';
import { MentionDropdown } from './editor/MentionDropdown';
import { PreviewPane } from './editor/PreviewPane';
import { PropertiesBlock } from './editor/PropertiesBlock';
import { getPreviewScrollAnchor, restorePreviewScrollAnchor, scrollPreviewToLine, type ScrollAnchor } from './editor/scrollAnchor';
import { SlashCommandDropdown, type SlashCommand } from './editor/SlashCommandDropdown';
import { useCodeMirror } from './editor/useCodeMirror';

const ATTACHMENT_PASTE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

interface EditorTab {
  id: string;
  title: string;
}

interface EditorLineJumpRequest {
  noteId: string;
  lineIndex: number;
  requestId: number;
}

export interface EditorFocusRequest {
  noteId: string;
  // 'title': rename field, name selected (a fresh note).
  // 'slot': the caret where the template's writing starts; a note this call
  // created, so it may add the space an empty `- [ ]` is missing.
  // 'open': an existing note, never edited: the slot if it is usable as is,
  // else the end. 'keep': the note was already open; leave the caret.
  target: 'title' | 'slot' | 'open' | 'keep';
  requestId: number;
}

interface EditorProps {
  note?: Note;
  allNotes: Note[];
  folders?: Folder[];
  onUpdate: (content: string) => void;
  onNoteUpdate?: (note: Note, update?: (current: Note) => Note) => void;
  /** Writes a vault/imported note's out-of-band frontmatter (`note.rawFrontmatter`). */
  onFrontmatterChange?: (rawFrontmatter: string | undefined) => void;
  onRename?: (title: string) => void;
  onClose?: () => void;
  onNavigateToNoteLegacy: (title: string) => void;
  onNavigateToNoteById: (id: string, anchor?: string) => void;
  onRestoreSnapshot?: (snapshot: NoteSnapshot) => Promise<void>;
  viewMode: 'edit' | 'preview';
  setViewMode: (mode: 'edit' | 'preview') => void;
  settings: AppSettings;
  tabs?: EditorTab[];
  enteringTabIds?: string[];
  closingTabIds?: string[];
  onTabChange?: (id: string) => void;
  onTabClose?: (id: string) => void;
  onTabReorder?: (sourceId: string, targetId: string, after: boolean) => void;
  onNewTab?: () => void;
  onTabEnterComplete?: (id: string) => void;
  onTabCloseAnimationComplete?: (id: string) => void;
  liftTabStrip?: boolean;
  reserveTitlebarTraffic?: boolean;
  reserveTitlebarActions?: boolean;
  readOnly?: boolean;
  attachmentMutationsDisabled?: boolean;
  lineJumpRequest?: EditorLineJumpRequest | null;
  onLineJumpHandled?: (requestId: number) => void;
  focusRequest?: EditorFocusRequest | null;
  onFocusRequestHandled?: (requestId: number) => void;
}

export default function Editor({
  note,
  allNotes,
  folders,
  onUpdate,
  onNoteUpdate,
  onFrontmatterChange,
  onRename,
  onClose,
  onNavigateToNoteLegacy,
  onNavigateToNoteById,
  viewMode,
  setViewMode,
  settings,
  tabs,
  enteringTabIds,
  closingTabIds,
  onTabChange,
  onTabClose,
  onTabReorder,
  onNewTab,
  onTabEnterComplete,
  onTabCloseAnimationComplete,
  liftTabStrip = false,
  reserveTitlebarTraffic = false,
  reserveTitlebarActions = false,
  onRestoreSnapshot,
  readOnly = false,
  attachmentMutationsDisabled = false,
  lineJumpRequest,
  onLineJumpHandled,
  focusRequest,
  onFocusRequestHandled,
}: EditorProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // Keep exports in the titlebar; outline and view controls stay with the note.
  const [titlebarExportSlot, setTitlebarExportSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTitlebarExportSlot(reserveTitlebarActions ? document.getElementById(TITLEBAR_NOTE_ACTIONS_SLOT_ID) : null);
  }, [reserveTitlebarActions]);
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [mentionQuery, setMentionQuery] = useState<{ query: string; index: number; x: number; y: number } | null>(null);
  const [slashQuery, setSlashQuery] = useState<{ query: string; index: number; x: number; y: number } | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [printNote, setPrintNote] = useState<Note | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const editPaneRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<ScrollAnchor>({ lineIndex: 0, progress: 0, top: true });
  const scrollViewRef = useRef<{ noteId?: string; mode: 'edit' | 'preview' }>({ mode: viewMode });
  const isDark = useIsDark(settings.appearance.theme);
  // Lives under CodeMirror's inline title widget, so Properties sit below the title and scroll with the note.
  const [propertiesSlot] = useState(() => document.createElement('div'));

  const handleNoteUpdate = useCallback((updated: Note, update?: (current: Note) => Note) => {
    onNoteUpdate?.(updated, update);
  }, [onNoteUpdate]);

  const { objectUrls, uploadFile, deleteAttachment, attachmentLoadError } = useAttachments(
    note ?? null,
    handleNoteUpdate
  );


  // Preview gets deferred values so keystrokes paint before the expensive re-parse. The deferred
  // value can be starved after a note switch (preview went blank until reload), so gate on the note id
  // lagging one frame and read the fresh note meanwhile; same-id typing still takes the deferred branch.
  const deferredNote = useDeferredValue<Note | undefined>(note, undefined);
  const deferredAllNotes = useDeferredValue(allNotes);
  const [settledNoteId, setSettledNoteId] = useState(note?.id);
  useEffect(() => {
    setSettledNoteId(note?.id);
  }, [note?.id]);
  const previewNote = note?.id !== settledNoteId
    ? undefined
    : deferredNote?.id === note?.id
      ? deferredNote
      : note;

  const noteProperties = useNoteProperties(note, allNotes, { onUpdate, onFrontmatterChange });
  const [addPropertyRequest, setAddPropertyRequest] = useState(0);
  const [addingFirstProperty, setAddingFirstProperty] = useState(false);
  useEffect(() => { setAddingFirstProperty(false); setAddPropertyRequest(0); }, [note?.id]);
  const handleAddProperty = useCallback((trigger: 'dashes' | 'shortcut') => {
    if (readOnly || !noteProperties.canWrite || !noteProperties.frontmatter) return false;
    const exists = noteProperties.frontmatter.exists;
    // With properties already present, --- is just a horizontal rule in the body.
    if (trigger === 'dashes' && exists) return false;
    if (!exists) setAddingFirstProperty(true);
    setAddPropertyRequest((n) => n + 1);
    return true;
  }, [noteProperties.canWrite, noteProperties.frontmatter, readOnly]);

  // Image references resolve to the attachment's object URL. Depends on the attachment list, not the note, so typing doesn't redraw images.
  const attachments = note?.attachments;
  const vaultPath = note?.vaultPath;
  const resolveImage = useCallback(
    (target: string) => {
      const attachment = findNoteAttachment({ attachments, vaultPath }, target);
      return attachment ? objectUrls.get(attachment.id) : undefined;
    },
    [attachments, vaultPath, objectUrls],
  );
  // Built on click, not per render: allNotes changes on every keystroke and the index is only needed here.
  const handleOpenLink = useCallback((link: OpenableLink) => {
    // Heading anchors are handled inside the editor, where the live document is.
    if (link.kind === 'anchor') return;
    // Same resolution as the Reading view: external links leave the app, notes resolve by title or path.
    if (link.kind === 'url' && /^(https?|mailto):/i.test(link.href)) {
      window.open(link.href, '_blank', 'noopener,noreferrer');
      return;
    }
    const title = link.kind === 'wiki' ? link.target.split('#')[0].trim() : parseMarkdownLinkTarget(link.href);
    if (!title) return;
    const targetId = resolveLinkTarget(title, buildLinkIndex(allNotes, folders ?? []), note?.folder ?? '');
    const anchor = link.kind === 'wiki' ? link.target.split('#')[1]?.trim() : parseMarkdownLinkAnchor(link.href) ?? undefined;
    if (targetId) onNavigateToNoteById(targetId, anchor || undefined);
    else if (link.kind === 'wiki') onNavigateToNoteLegacy(title);
  }, [allNotes, folders, note?.folder, onNavigateToNoteById, onNavigateToNoteLegacy]);

  const { editorViewRef, insertFormatting, jumpToLine, insertMention, insertSlashCommand } = useCodeMirror({
    containerRef: editorContainerRef,
    maxWidth: settings.appearance.maxWidth,
    note,
    isDark,
    onUpdate,
    onMentionTrigger: setMentionQuery,
    onSlashTrigger: setSlashQuery,
    editPaneRef,
    readOnly,
    propertiesSlot,
    onAddProperty: handleAddProperty,
    onOpenLink: handleOpenLink,
    resolveImage,
  });

  useEffect(() => {
    if (!lineJumpRequest || lineJumpRequest.noteId !== note?.id || viewMode === 'preview') return;
    const lineCount = note.content.split('\n').length;
    const frame = window.requestAnimationFrame(() => {
      if (lineJumpRequest.lineIndex >= 0 && lineJumpRequest.lineIndex < lineCount) {
        jumpToLine(lineJumpRequest.lineIndex);
      }
      onLineJumpHandled?.(lineJumpRequest.requestId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [jumpToLine, lineJumpRequest, note?.content, note?.id, onLineJumpHandled, viewMode]);

  // Restore the source position across layouts without changing the selection or undo history.
  useEffect(() => {
    const view = editorViewRef.current;
    const container = viewMode === 'preview' ? previewScrollRef.current : view?.scrollDOM;
    const noteId = note?.id;
    if (!noteId || !view || !container) return;
    const previous = scrollViewRef.current;
    const switched = previous.noteId === noteId && previous.mode !== viewMode;
    if (previous.noteId !== noteId) scrollAnchorRef.current = { lineIndex: 0, progress: 0, top: true };
    scrollViewRef.current = { noteId, mode: viewMode };
    // The edit pane is display:none in reading view, so the title was drawn at 0 height if the editor mounted there.
    if (viewMode !== 'preview') remeasureTitle(view);
    const anchor = scrollAnchorRef.current;
    let disposed = false;
    const capture = () => {
      if (viewMode === 'preview') {
        scrollAnchorRef.current = getPreviewScrollAnchor(container);
      } else {
        const height = Math.max(0, container.getBoundingClientRect().top - view.documentTop);
        const block = view.lineBlockAtHeight(height);
        const firstLine = view.state.doc.lineAt(block.from).number;
        const lineCount = view.state.doc.lineAt(block.to).number - firstLine + 1;
        const position = (block.height > 0 ? Math.max(0, Math.min(0.999999, (height - block.top) / block.height)) : 0) * lineCount;
        scrollAnchorRef.current = {
          lineIndex: firstLine - 1 + Math.floor(position),
          progress: position % 1,
          top: container.scrollTop === 0,
        };
      }
    };
    const frame = window.requestAnimationFrame(() => {
      if (switched && lineJumpRequest?.noteId !== noteId) {
        if (viewMode === 'preview') {
          restorePreviewScrollAnchor(container, anchor);
        } else if (anchor.top) {
          container.scrollTop = 0;
        } else {
          const line = view.state.doc.line(Math.min(view.state.doc.lines, anchor.lineIndex + 1));
          view.requestMeasure({
            read: () => view.lineBlockAt(line.from),
            write: (block) => {
              if (disposed) return;
              const firstLine = view.state.doc.lineAt(block.from).number - 1;
              const lineCount = view.state.doc.lineAt(block.to).number - firstLine;
              const progress = (anchor.lineIndex - firstLine + anchor.progress) / lineCount;
              container.scrollTop = view.documentTop - container.getBoundingClientRect().top + container.scrollTop + block.top + block.height * progress;
            },
          });
        }
      }
      capture();
      container.addEventListener('scroll', capture, { passive: true });
    });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      container.removeEventListener('scroll', capture);
    };
  }, [editorViewRef, note?.id, previewNote?.id, viewMode, isDark, lineJumpRequest?.noteId]);

  // ⌘F / Ctrl+F opens Find & Replace when the editor is focused
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || viewMode === 'preview') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
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

  // Word count and TOC scan the full document — ride the deferred note (same
  // one the preview uses) so these O(doc) passes run in the low-priority
  // follow-up render instead of on the urgent keystroke render. On note switch
  // the deferred value lags one frame; fall back to the fresh note there.
  const scanNote = deferredNote?.id === note?.id ? deferredNote : note;

  const stats = useMemo(() => {
    const text = scanNote?.content ?? '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { chars: text.length, words };
  }, [scanNote?.content]);

  useEffect(() => {
    // Reset transient UI when the active note changes (including to undefined), so stale dropdowns don't suggest the old note is still being edited.
    setTitleInput(note?.title || '');
    setMentionQuery(null);
    setSlashQuery(null);
    setIsHistoryOpen(false);
    setIsFindReplaceOpen(false);
    setIsEditingTitle(false);
    setImageError(null);
    setIsTocOpen(false);
    // Keyed on note id, not the note object, so title edits don't trigger the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Declared after the note-switch reset above, and deferred a frame, so the
  // reset's setIsEditingTitle(false) for the new note cannot land after this.
  useEffect(() => {
    if (!focusRequest || focusRequest.noteId !== note?.id) return;
    const frame = window.requestAnimationFrame(() => {
      onFocusRequestHandled?.(focusRequest.requestId);
      if (readOnly) return;
      if (focusRequest.target === 'title') {
        setIsEditingTitle(true);
        return;
      }
      const view = editorViewRef.current;
      if (!view || viewMode === 'preview') return;
      if (focusRequest.target !== 'keep') {
        const caret = bodyCaretTarget(view.state.doc.toString());
        const insert = focusRequest.target === 'slot' ? caret.insert : undefined;
        view.dispatch({
          changes: insert ? { from: caret.anchor - insert.length, insert } : undefined,
          selection: { anchor: caret.insert && !insert ? view.state.doc.length : caret.anchor },
          scrollIntoView: true,
        });
      }
      view.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorViewRef, focusRequest, note?.id, onFocusRequestHandled, readOnly, viewMode]);

  // Paste/drop file support (images only → attachment system)
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || viewMode === 'preview' || readOnly) return;

    const handleFiles = async (files: File[]) => {
      if (attachmentMutationsDisabled) {
        setImageError('Vault attachments are managed from the connected folder.');
        setTimeout(() => setImageError(null), 3000);
        return;
      }
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
          // Fallback when no onNoteUpdate: inline base64 embed
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
  }, [attachmentMutationsDisabled, viewMode, insertFormatting, onNoteUpdate, readOnly, uploadFile]);

  const tocHeadings = useMemo(() => {
    if (!scanNote) return [];
    return scanHeadings(scanNote.content);
    // scanNote is read via scanNote?.content; depending on the content string
    // (not the scanNote object ref) avoids re-running the scan on every
    // parent re-render that produces a new scanNote identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanNote?.content]);

  const handleTitleSubmit = useCallback(() => {
    setIsEditingTitle(false);
    if (onRename && note && titleInput.trim() !== note.title) {
      onRename(titleInput.trim() || 'Untitled');
    } else if (note) {
      setTitleInput(note.title || 'Untitled');
    }
  }, [onRename, note, titleInput]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit();
      // Naming a note is the step before writing it. Wait a frame so the
      // input has unmounted: moving focus while it is still mounted would
      // blur it and submit the rename a second time.
      if (viewMode !== 'preview' && !readOnly) {
        window.requestAnimationFrame(() => editorViewRef.current?.focus());
      }
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
      setTitleInput(note?.title || 'Untitled');
    }
  }, [editorViewRef, handleTitleSubmit, note?.title, readOnly, viewMode]);

  const editorStyle: React.CSSProperties = {
    fontSize: `${settings.editor.fontSize}px`,
    lineHeight: settings.editor.lineHeight,
    fontFamily: resolveFontFamily(settings.appearance.fontFamily),
  };

  // The editor shows Properties only once a note has some, or while the first
  // one is being named (--- / Cmd+;); abandoning that leaves no block.
  // Only the edit pane takes add requests: the reading view's copy is read-only and must not show the name input.
  const renderProperties = (pane: 'edit' | 'preview') => {
    const frontmatter = noteProperties.frontmatter;
    const adding = pane === 'edit' && addingFirstProperty;
    if (!frontmatter || !(frontmatter.exists || adding)) return null;
    return (
      <PropertiesBlock
        getSuggestions={noteProperties.getSuggestions}
        block={frontmatter.block}
        readOnly={readOnly || !noteProperties.canWrite}
        onChange={noteProperties.onChange}
        onOpenLink={(target) => handleOpenLink({ kind: 'wiki', target })}
        {...(pane === 'edit' ? {
          addRequest: addPropertyRequest,
          onAddEnd: () => { setAddingFirstProperty(false); setAddPropertyRequest(0); },
        } : {})}
      />
    );
  };

  const contentMaxWidthStyle: React.CSSProperties = {
    maxWidth: `${settings.appearance.maxWidth}px`,
    margin: '0 auto',
  };

  // PDF export: force the light theme so the printed page is white regardless
  // of the app theme.
  const printSettings = useMemo(
    (): AppSettings => ({
      ...settings,
      appearance: { ...settings.appearance, theme: 'light' },
    }),
    [settings]
  );

  // PDF export flow: mount the hidden print root, wait for fonts/images (and a
  // beat for async blocks like Mermaid), then hand off to the system print
  // dialog where the user picks "Save as PDF".
  useEffect(() => {
    if (!printNote) return;
    let cancelled = false;
    const previousTitle = document.title;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      document.title = previousTitle;
      setPrintNote(null);
    };
    const run = async () => {
      try {
        await document.fonts.ready;
      } catch {
        // fonts API unavailable — print anyway
      }
      const root = document.getElementById('noa-print-root');
      const images = root ? Array.from(root.querySelectorAll('img')) : [];
      await Promise.all(
        images.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              })
        )
      );
      // Mermaid diagrams render asynchronously with no completion signal here.
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (cancelled) return;
      // The document title becomes the default PDF filename.
      document.title = printNote.title || 'Untitled';
      window.addEventListener('afterprint', finish, { once: true });
      // window.print() blocks until the dialog closes in Chromium/Electron;
      // the timeout covers engines where afterprint never fires.
      window.print();
      setTimeout(finish, 1000);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [printNote]);

  if (!note) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[var(--surface-page,#F9F9F7)] font-ui select-none">
        <div className="flex flex-col gap-8 w-56">
          {/* Wordmark */}
          <div className="flex flex-col gap-1">
            <div className="text-4xl font-bold text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_75%,transparent)] tracking-tight">Noa</div>
            <div className="text-micro text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_30%,transparent)] uppercase tracking-widest">your private writing space</div>
          </div>

          {/* Shortcuts */}
          <div className="flex flex-col gap-2.5">
            {[
              { key: '⌘N', desc: 'New note' },
              { key: '⌘F', desc: 'Search notes' },
              { key: '⌘K', desc: 'Command palette' },
            ].map(({ key, desc }) => (
              <div key={key} className="flex items-center gap-3">
                <span className="text-micro font-bold text-[color-mix(in_srgb,var(--accent-color,#CC7D5E)_60%,transparent)] tracking-widest w-7">{key}</span>
                <span className="text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_15%,transparent)]">·</span>
                <span className="text-xs text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_40%,transparent)]">{desc}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="text-micro text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_20%,transparent)] tracking-wide">
            Notes stored locally · Export regularly
          </div>
        </div>
      </div>
    );
  }

  const editorActions = (
    <EditorActions
      exportSlot={titlebarExportSlot}
      isDark={isDark}
      viewMode={viewMode}
      setViewMode={setViewMode}
      onExportMd={() => exportNoteAsMd(note)}
      onExportHtml={() => exportNoteAsHtml(note)}
      onExportPdf={() => setPrintNote(note)}
      onToggleHistory={onRestoreSnapshot ? () => setIsHistoryOpen(v => !v) : undefined}
      isHistoryOpen={isHistoryOpen}
      headings={tocHeadings}
      isTocOpen={isTocOpen}
      onToggleToc={() => setIsTocOpen(v => !v)}
      onCloseToc={() => setIsTocOpen(false)}
      onJumpToLine={(lineIndex) => {
        if (viewMode === 'preview') {
          if (previewScrollRef.current) scrollPreviewToLine(previewScrollRef.current, lineIndex);
        } else {
          jumpToLine(lineIndex);
        }
      }}
    />
  );

  return (
    <div
      className="flex-1 flex flex-col min-w-0 bg-[var(--surface-page,#F9F9F7)] relative"
    >
      <EditorHeader
        note={note}
        isDark={isDark}
        tabs={tabs}
        isEditingTitle={isEditingTitle}
        titleInput={titleInput}
        onTitleInputChange={setTitleInput}
        onTitleSubmit={handleTitleSubmit}
        onTitleKeyDown={handleTitleKeyDown}
        onSetEditingTitle={setIsEditingTitle}
        onTabChange={onTabChange}
        onTabClose={onTabClose}
        onTabReorder={onTabReorder}
        onNewTab={onNewTab}
        onClose={onClose}
        titleInputRef={titleInputRef}
        enteringTabIds={enteringTabIds}
        closingTabIds={closingTabIds}
        onTabEnterComplete={onTabEnterComplete}
        onTabCloseAnimationComplete={onTabCloseAnimationComplete}
        liftTabStrip={liftTabStrip}
        reserveTitlebarTraffic={reserveTitlebarTraffic}
        reserveTitlebarActions={reserveTitlebarActions}
        readOnly={readOnly}
      />

      {isFindReplaceOpen && viewMode !== 'preview' && (
        <FindReplacePanel
          editorViewRef={editorViewRef}
          content={note?.content ?? ''}
          isDark={isDark}
          onClose={() => setIsFindReplaceOpen(false)}
        />
      )}

      {(imageError || attachmentLoadError) && (
        <div className="px-4 py-1.5 bg-[#D45555]/10 border-b border-[#D45555]/60 text-[#A93B3B] text-xs font-ui flex items-center justify-between shrink-0 z-20">
          <span>{imageError || attachmentLoadError}</span>
          <button onClick={() => setImageError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <div
        className="flex-1 flex overflow-hidden z-10 relative"
      >
        <div
          className="absolute top-1 z-30"
          // 15px matches the titlebar actions' trailing inset (TopBar), so the two rows share a right edge.
          style={{ right: 'calc(15px + var(--noa-rail-reserve, 0px))', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {editorActions}
        </div>
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
            flex: '1',
            // No padding here: the side insets, including the note rail's reserve, live on .cm-scroller so it runs to the
            // window edge with its scrollbar there, as the reading view's does; vertical room lives in .cm-content.
          }}
        >
          <div className="h-full" style={editorStyle}>
            <div ref={editorContainerRef} className="h-full" />
          </div>
          {viewMode !== 'preview' && createPortal(renderProperties('edit'), propertiesSlot)}

          {/* Plain muted caption in the bottom-right corner, on the page colour. Opaque so scrolled text cannot show through it.
              Clear of the note rail reserve (same inset as the editor toolbar). */}
          <div
            className="absolute bottom-0 z-10 h-7 flex items-center px-2 text-xs font-ui whitespace-nowrap pointer-events-none text-[var(--text-secondary,#7B7974)] bg-[var(--bg-primary,#FCFCFB)]"
            style={{ right: 'calc(0.75rem + var(--noa-rail-reserve, 0px))' }}
          >
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
              onDismiss={() => setMentionQuery(null)}
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

        {viewMode === 'preview' && previewNote && (
          <PreviewPane
            note={previewNote}
            scrollContainerRef={previewScrollRef}
            allNotes={deferredAllNotes}
            folders={folders}
            settings={settings}
            onNavigateToNoteLegacy={onNavigateToNoteLegacy}
            onNavigateToNoteById={onNavigateToNoteById}
            editorStyle={editorStyle}
            contentMaxWidthStyle={contentMaxWidthStyle}
            objectUrls={objectUrls}
            lineJumpRequest={lineJumpRequest}
            onLineJumpHandled={onLineJumpHandled}
            properties={renderProperties('preview')}
          />
        )}
      </div>

      {printNote && createPortal(
        <div id="noa-print-root">
          <PreviewPane
            note={printNote}
            allNotes={allNotes}
            folders={folders}
            settings={printSettings}
            onNavigateToNoteLegacy={() => {}}
            onNavigateToNoteById={() => {}}
            editorStyle={editorStyle}
            contentMaxWidthStyle={{ maxWidth: '100%' }}
            objectUrls={objectUrls}
            printMode
          />
        </div>,
        document.body
      )}

      {onNoteUpdate && (
        <AttachmentPanel
          attachments={note.attachments ?? []}
          onUpload={uploadFile}
          onDelete={deleteAttachment}
          onInsertReference={(filename) => {
            const syntax = `![[${filename}]]`;
            insertFormatting(syntax);
          }}
          readOnly={readOnly}
          mutationsDisabled={attachmentMutationsDisabled}
          mutationsDisabledReason="Manage vault attachments from the connected folder."
        />
      )}
    </div>
  );
}
