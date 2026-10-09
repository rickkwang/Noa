import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, ViewUpdate, placeholder as cmPlaceholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef, useCallback } from 'react';
import { Note } from '../../types';
import { codeDecorations } from './codeDecorations';
import { buildMinimalReplaceChange } from './contentSync';
import { hideTaskMarkers } from './hideTaskMarkers';
import { inlineTitle, setInlineTitle } from './inlineTitle';

// Marks external content syncs so they stay out of the user's undo history.
const remoteSyncAnnotation = Annotation.define<boolean>();

// Module-level pure function — no stale closure risk
function applyInlineFormat(view: EditorView, before: string, after: string, placeholder: string): boolean {
  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);
  const text = selected || placeholder;
  view.dispatch({
    changes: { from, to, insert: before + text + after },
    selection: { anchor: from + before.length, head: from + before.length + text.length },
  });
  view.focus();
  return true;
}

// Warm dark palette: bg #2D2D2B, text #F9F9F7, accent #CC7D5E
const darkTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#F9F9F7' },
  '.cm-content': { caretColor: '#F9F9F7', fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit', padding: '2rem 2rem 3.5rem 0' },
  '.cm-focused': { outline: 'none !important' },
  '&.cm-focused': { outline: 'none !important' },
  // CodeMirror's base theme pins the scroller at 1.4, which .cm-content then
  // inherits — without this the Line Height setting never reaches edit mode.
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-line': { padding: '0' },
  '.cm-code-line': { background: 'rgba(204,125,94,0.06)', borderLeft: '2px solid rgba(204,125,94,0.45)', padding: '0 0 0 0.85rem', boxSizing: 'border-box' },
  '.cm-code-line-first': { paddingTop: '0.5rem', borderTopLeftRadius: '4px' },
  '.cm-code-line-last': { paddingBottom: '0.5rem', borderBottomLeftRadius: '4px' },
  '.cm-inline-code': { background: 'rgba(204,125,94,0.07)', borderRadius: '4px', padding: '0.05em 0.3em' },
  '.cm-cursor': { borderLeftColor: '#F9F9F7' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(204,125,94,0.25)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(204,125,94,0.38)' },
  '.cm-activeLine': { backgroundColor: 'rgba(249,249,247,0.03)' },
  '.cm-gutters': { display: 'none' },
  '.cm-placeholder': { color: 'rgba(249,249,247,0.28)' },
}, { dark: true });

const darkMarkdownHighlightStyle = HighlightStyle.define([
  // Obsidian's ×1.125 heading scale, mirrored by `.prose h1…h5` in index.css so headings don't jump between edit and preview.
  { tag: tags.heading1, fontSize: '1.802em', lineHeight: '1.2', fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.heading2, fontSize: '1.602em', lineHeight: '1.2', fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.heading3, fontSize: '1.424em', lineHeight: '1.3', fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.heading4, fontSize: '1.266em', lineHeight: '1.4', fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.heading5, fontSize: '1.125em', lineHeight: '1.5', fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.heading6, lineHeight: '1.5', fontWeight: 'var(--font-weight-content-bold)' },
  // Matches `.prose strong` in index.css.
  { tag: tags.strong, fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'inherit', color: '#F9F9F7' },
  { tag: tags.link, color: '#CC7D5E', textDecoration: 'underline' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.processingInstruction, tags.meta], color: 'rgba(249,249,247,0.32)', fontFamily: 'inherit' },
  { tag: tags.quote, fontStyle: 'italic', color: 'rgba(249,249,247,0.52)' },
]);

const lightTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#2D2D2B' },
  '.cm-content': { caretColor: '#2D2D2B', fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit', padding: '2rem 2rem 3.5rem 0' },
  '.cm-focused': { outline: 'none !important' },
  '&.cm-focused': { outline: 'none !important' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-line': { padding: '0' },
  '.cm-code-line': { background: 'rgba(204,125,94,0.09)', borderLeft: '2px solid rgba(204,125,94,0.6)', padding: '0 0 0 0.85rem', boxSizing: 'border-box' },
  '.cm-code-line-first': { paddingTop: '0.5rem', borderTopLeftRadius: '4px' },
  '.cm-code-line-last': { paddingBottom: '0.5rem', borderBottomLeftRadius: '4px' },
  '.cm-inline-code': { background: 'rgba(204,125,94,0.14)', borderRadius: '4px', padding: '0.05em 0.3em' },
  '.cm-cursor': { borderLeftColor: '#2D2D2B' },
  '.cm-selectionBackground': { backgroundColor: '#CC7D5E40' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: '#CC7D5E60' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
  '.cm-placeholder': { color: '#2D2D2B50' },
});

const markdownHighlightStyle = HighlightStyle.define([
  // Obsidian's ×1.125 heading scale, mirrored by `.prose h1…h5` in index.css so headings don't jump between edit and preview.
  { tag: tags.heading1, fontSize: '1.802em', lineHeight: '1.2', fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.heading2, fontSize: '1.602em', lineHeight: '1.2', fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.heading3, fontSize: '1.424em', lineHeight: '1.3', fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.heading4, fontSize: '1.266em', lineHeight: '1.4', fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.heading5, fontSize: '1.125em', lineHeight: '1.5', fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.heading6, lineHeight: '1.5', fontWeight: 'var(--font-weight-content-bold)' },
  // Matches `.prose strong` in index.css.
  { tag: tags.strong, fontWeight: 'var(--font-weight-content-bold)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'inherit', color: '#2D2D2B' },
  { tag: tags.link, color: '#CC7D5E', textDecoration: 'underline' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.processingInstruction, tags.meta], color: '#2D2D2B40', fontFamily: 'inherit' },
  { tag: tags.quote, fontStyle: 'italic', color: '#2D2D2B80' },
]);

// Caps the content column to a reading width. Padding stays in the base theme's .cm-content shorthand so
// this compartment's ordering can't clobber it (see the editPane note in Editor.tsx).
const buildWidthTheme = (w: number) => EditorView.theme({
  '.cm-content': { maxWidth: `${w}px`, margin: '0 auto', boxSizing: 'border-box' },
});

const buildReadOnlyExtensions = (readOnly: boolean) => [
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
];

interface UseCodeMirrorOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  note: Note | undefined;
  isDark: boolean;
  onUpdate: (content: string) => void;
  onMentionTrigger: (query: { query: string; index: number; x: number; y: number } | null) => void;
  onSlashTrigger: (query: { query: string; index: number; x: number; y: number } | null) => void;
  editPaneRef: React.RefObject<HTMLDivElement | null>;
  maxWidth: number;
  readOnly?: boolean;
}

export function useCodeMirror({
  containerRef,
  note,
  isDark,
  onUpdate,
  onMentionTrigger,
  onSlashTrigger,
  editPaneRef,
  maxWidth,
  readOnly = false,
}: UseCodeMirrorOptions) {
  const editorViewRef = useRef<EditorView | null>(null);
  const savedCursorRef = useRef<number>(0);
  const lastBuiltNoteIdRef = useRef<string | undefined>(undefined);
  // Per-note cursor so A → B → A restores A's position. Written on teardown only; deleted notes age out.
  const cursorByNoteIdRef = useRef<Map<string, number>>(new Map());
  const widthCompartmentRef = useRef(new Compartment());
  const maxWidthRef = useRef(maxWidth);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const readOnlyRef = useRef(readOnly);

  // Mirror of the EditorView's content, so React round trips skip another O(doc) serialization.
  // Remote transactions update it too, so an older local value can't mask an external A -> B -> A.
  const editorContentRef = useRef<string | null>(null);

  // Keep callback refs stable so the CodeMirror instance never captures stale closures
  const onUpdateRef = useRef(onUpdate);
  const onMentionTriggerRef = useRef(onMentionTrigger);
  const onSlashTriggerRef = useRef(onSlashTrigger);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
  useEffect(() => { onMentionTriggerRef.current = onMentionTrigger; }, [onMentionTrigger]);
  useEffect(() => { onSlashTriggerRef.current = onSlashTrigger; }, [onSlashTrigger]);

  // Build CodeMirror instance — recreate only when note id or dark mode changes
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      const isRemoteSync = update.transactions.some((transaction) => transaction.annotation(remoteSyncAnnotation));
      if (update.docChanged) {
        const content = update.state.doc.toString();
        editorContentRef.current = content;
        // Suppress onUpdate during IME composition: firing mid-composition makes link extraction race the
        // user's CJK input. compositionend flushes the complete content.
        if (!isRemoteSync && !update.view.composing) {
          onUpdateRef.current(content);

          const cursor = update.state.selection.main.head;
          const textBefore = content.slice(0, cursor);
          const mentionMatch = textBefore.match(/\[\[([^\]]*)$/);
          const slashMatch = textBefore.match(/(^|\n)(\/\w*)$/);
          if (mentionMatch) {
            const coords = update.view.coordsAtPos(cursor);
            const pane = editPaneRef.current;
            let x = 32, y = 32;
            if (coords && pane) {
              const rect = pane.getBoundingClientRect();
              x = Math.max(0, Math.min(coords.left - rect.left, rect.width - 270));
              y = Math.min(coords.bottom - rect.top + 4, rect.height - 200);
            }
            onMentionTriggerRef.current({ query: mentionMatch[1].toLowerCase(), index: mentionMatch.index!, x, y });
            onSlashTriggerRef.current(null);
          } else if (slashMatch) {
            const slashStart = textBefore.lastIndexOf('/');
            if (slashStart === -1) {
              onMentionTriggerRef.current(null);
              onSlashTriggerRef.current(null);
            } else {
            const coords = update.view.coordsAtPos(cursor);
            const pane = editPaneRef.current;
            let x = 32, y = 32;
            if (coords && pane) {
              const rect = pane.getBoundingClientRect();
              x = Math.max(0, Math.min(coords.left - rect.left, rect.width - 270));
              y = Math.min(coords.bottom - rect.top + 4, rect.height - 200);
            }
            onSlashTriggerRef.current({ query: slashMatch[2].slice(1).toLowerCase(), index: slashStart, x, y });
            onMentionTriggerRef.current(null);
            }
          } else {
            onMentionTriggerRef.current(null);
            onSlashTriggerRef.current(null);
          }
        }
      }
      savedCursorRef.current = update.state.selection.main.head;
    });

    const insertMentionKeymap = keymap.of([
      {
        key: 'Tab',
        run: (view) => {
          view.dispatch(view.state.replaceSelection('  '));
          return true;
        },
      },
      { key: 'Mod-b', run: (view) => applyInlineFormat(view, '**', '**', 'bold text') },
      { key: 'Mod-i', run: (view) => applyInlineFormat(view, '*', '*', 'italic text') },
      { key: 'Mod-e', run: (view) => applyInlineFormat(view, '`', '`', 'code') },
      {
        key: 'Mod-Shift-x',
        run: (view) => {
          const line = view.state.doc.lineAt(view.state.selection.main.from);
          view.dispatch({ changes: { from: line.from, insert: '- [ ] ' } });
          view.focus();
          return true;
        },
      },
    ]);

    const extensions = [
      markdown(),
      syntaxHighlighting(isDark ? darkMarkdownHighlightStyle : markdownHighlightStyle),
      hideTaskMarkers,
      codeDecorations,
      updateListener,
      insertMentionKeymap,
      history(),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      cmPlaceholder('Start typing...'),
      readOnlyCompartmentRef.current.of(buildReadOnlyExtensions(readOnlyRef.current)),
      inlineTitle(note?.title || 'Untitled'),
      EditorView.lineWrapping,
      isDark ? darkTheme : lightTheme,
      widthCompartmentRef.current.of(buildWidthTheme(maxWidthRef.current)),
    ];

    const docContent = note?.content ?? '';
    editorContentRef.current = docContent;
    // Per-note cursor on note switch; savedCursorRef when rebuilding the same note (e.g. dark-mode toggle).
    const perNoteCursor = note?.id ? cursorByNoteIdRef.current.get(note.id) : undefined;
    const cursorPos = note?.id === lastBuiltNoteIdRef.current
      ? Math.min(savedCursorRef.current, docContent.length)
      : Math.min(perNoteCursor ?? 0, docContent.length);
    lastBuiltNoteIdRef.current = note?.id;

    const state = EditorState.create({
      doc: docContent,
      extensions,
      selection: { anchor: cursorPos },
    });

    const view = new EditorView({ state, parent: containerRef.current });
    editorViewRef.current = view;

    // Flush once when IME composition ends, since updateListener skipped
    // intermediate transactions while view.composing was true.
    const handleCompositionEnd = () => {
      const content = view.state.doc.toString();
      editorContentRef.current = content;
      onUpdateRef.current(content);
    };
    view.contentDOM.addEventListener('compositionend', handleCompositionEnd);

    return () => {
      const finalCursor = view.state.selection.main.head;
      savedCursorRef.current = finalCursor;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (note?.id) cursorByNoteIdRef.current.set(note.id, finalCursor);
      view.contentDOM.removeEventListener('compositionend', handleCompositionEnd);
      view.destroy();
      editorViewRef.current = null;
    };
    // note?.content is omitted on purpose: content changes dispatch below instead of rebuilding (which would drop cursor + undo history).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, isDark]);

  // Dynamically update content max-width without rebuilding the editor
  useEffect(() => {
    maxWidthRef.current = maxWidth;
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({ effects: widthCompartmentRef.current.reconfigure(buildWidthTheme(maxWidth)) });
  }, [maxWidth]);

  // Toggled without a rebuild, which would drop cursor, scroll and undo history.
  useEffect(() => {
    readOnlyRef.current = readOnly;
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartmentRef.current.reconfigure(buildReadOnlyExtensions(readOnly)) });
  }, [readOnly]);

  // Sync external content changes without destroying undo history
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !note) return;
    // Guards against the editor's current content, not just the last local emit.
    if (note.content === editorContentRef.current) return;
    const currentDoc = editorContentRef.current ?? view.state.doc.toString();
    const minimalChange = buildMinimalReplaceChange(currentDoc, note.content);
    if (minimalChange) {
      view.dispatch({
        changes: minimalChange,
        annotations: [remoteSyncAnnotation.of(true), Transaction.addToHistory.of(false)],
      });
    }
    // Keyed on note?.content, not the note object, which is recreated on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.content]);

  // Rename refreshes the inline-title widget; rebuilds take the title from init instead.
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({ effects: setInlineTitle.of(note?.title || 'Untitled') });
  }, [note?.title]);

  const insertFormatting = useCallback((before: string, after: string = '') => {
    const view = editorViewRef.current;
    if (!view || view.state.readOnly) return;
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
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    view.focus();
  }, []);

  const insertMention = useCallback((title: string, mentionIndex: number) => {
    const view = editorViewRef.current;
    if (!view || view.state.readOnly) return;
    const { state } = view;
    const cursor = state.selection.main.head;
    view.dispatch({
      changes: { from: mentionIndex, to: cursor, insert: `[[${title}]]` },
      selection: { anchor: mentionIndex + title.length + 4 },
    });
    view.focus();
  }, []);

  // Insert a slash command at slashIndex (the position of `/`)
  const insertSlashCommand = useCallback((insertTemplate: string, slashIndex: number) => {
    const view = editorViewRef.current;
    if (!view || view.state.readOnly) return;
    const { state } = view;
    const cursor = state.selection.main.head;
    const cursorOffset = insertTemplate.indexOf('{cursor}');
    const text = insertTemplate.replace('{cursor}', '');
    const anchor = cursorOffset >= 0 ? slashIndex + cursorOffset : slashIndex + text.length;
    view.dispatch({
      changes: { from: slashIndex, to: cursor, insert: text },
      selection: { anchor },
    });
    view.focus();
  }, []);

  return { editorViewRef, insertFormatting, jumpToLine, insertMention, insertSlashCommand };
}
