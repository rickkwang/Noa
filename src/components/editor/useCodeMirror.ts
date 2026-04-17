import { useEffect, useRef, useCallback } from 'react';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, ViewUpdate, placeholder as cmPlaceholder } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Note } from '../../types';
import { buildMinimalReplaceChange } from './contentSync';

// Annotation to mark external content syncs so history does not merge them
// into the user's local undo stack.
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

// Warm dark palette: bg #262624, text #F0EDE6, accent #D97757
const darkTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#F0EDE6' },
  '.cm-content': { caretColor: '#F0EDE6', fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit', padding: '0' },
  '.cm-focused': { outline: 'none !important' },
  '&.cm-focused': { outline: 'none !important' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: '#F0EDE6' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(217,119,87,0.25)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(217,119,87,0.38)' },
  '.cm-activeLine': { backgroundColor: 'rgba(240,237,230,0.03)' },
  '.cm-gutters': { display: 'none' },
  '.cm-placeholder': { color: 'rgba(240,237,230,0.28)' },
}, { dark: true });

const darkMarkdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: 'bold' },
  { tag: tags.heading2, fontSize: '1.3em', fontWeight: 'bold' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: 'bold' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: '"JetBrains Mono", monospace', color: '#D97757', background: 'rgba(217,119,87,0.10)' },
  { tag: tags.link, color: '#D97757', textDecoration: 'underline' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.processingInstruction, tags.meta], color: 'rgba(240,237,230,0.32)', fontFamily: '"JetBrains Mono", monospace' },
  { tag: tags.quote, fontStyle: 'italic', color: 'rgba(240,237,230,0.52)' },
]);

const lightTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#2D2D2D' },
  '.cm-content': { caretColor: '#2D2D2D', fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit', padding: '0' },
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
  { tag: tags.monospace, fontFamily: '"JetBrains Mono", monospace', color: '#B89B5E', background: '#DCD9CE' },
  { tag: tags.link, color: '#B89B5E', textDecoration: 'underline' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.processingInstruction, tags.meta], color: '#2D2D2D40', fontFamily: '"JetBrains Mono", monospace' },
  { tag: tags.quote, fontStyle: 'italic', color: '#2D2D2D80' },
]);

interface UseCodeMirrorOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  note: Note | undefined;
  isDark: boolean;
  onUpdate: (content: string) => void;
  onMentionTrigger: (query: { query: string; index: number; x: number; y: number } | null) => void;
  onSlashTrigger: (query: { query: string; index: number; x: number; y: number } | null) => void;
  editPaneRef: React.RefObject<HTMLDivElement | null>;
  maxWidth: number;
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
}: UseCodeMirrorOptions) {
  const editorViewRef = useRef<EditorView | null>(null);
  const savedCursorRef = useRef<number>(0);
  const widthCompartmentRef = useRef(new Compartment());
  const maxWidthRef = useRef(maxWidth);

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
        // Suppress onUpdate while an IME composition is in-flight. Firing mid-
        // composition causes extractLinks/debounceSave to race with the user
        // finishing a CJK character, producing jittery link state. The final
        // compositionend triggers a regular docChanged transaction which will
        // flush the complete content.
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

    const buildWidthTheme = (w: number) => EditorView.theme({
      '.cm-content': { maxWidth: `${w}px`, margin: '0 auto', boxSizing: 'border-box', paddingRight: '2rem' },
    });

    const extensions = [
      markdown(),
      syntaxHighlighting(isDark ? darkMarkdownHighlightStyle : markdownHighlightStyle),
      updateListener,
      insertMentionKeymap,
      keymap.of([...defaultKeymap]),
      cmPlaceholder('Start typing...'),
      EditorView.lineWrapping,
      isDark ? darkTheme : lightTheme,
      widthCompartmentRef.current.of(buildWidthTheme(maxWidthRef.current)),
    ];

    const docContent = note?.content ?? '';
    const cursorPos = Math.min(savedCursorRef.current, docContent.length);

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
      onUpdateRef.current(view.state.doc.toString());
    };
    view.contentDOM.addEventListener('compositionend', handleCompositionEnd);

    return () => {
      savedCursorRef.current = view.state.selection.main.head;
      view.contentDOM.removeEventListener('compositionend', handleCompositionEnd);
      view.destroy();
      editorViewRef.current = null;
    };
  }, [note?.id, isDark]);

  // Dynamically update content max-width without rebuilding the editor
  useEffect(() => {
    maxWidthRef.current = maxWidth;
    const view = editorViewRef.current;
    if (!view) return;
    const buildWidthTheme = (w: number) => EditorView.theme({
      '.cm-content': { maxWidth: `${w}px`, margin: '0 auto', boxSizing: 'border-box', paddingRight: '2rem' },
    });
    view.dispatch({ effects: widthCompartmentRef.current.reconfigure(buildWidthTheme(maxWidth)) });
  }, [maxWidth]);

  // Sync external content changes without destroying undo history
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !note) return;
    const currentDoc = view.state.doc.toString();
    const minimalChange = buildMinimalReplaceChange(currentDoc, note.content);
    if (minimalChange) {
      view.dispatch({
        changes: minimalChange,
        annotations: remoteSyncAnnotation.of(true),
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
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    view.focus();
  }, []);

  const insertMention = useCallback((title: string, mentionIndex: number) => {
    const view = editorViewRef.current;
    if (!view) return;
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
    if (!view) return;
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
