import { useEffect, useRef, useCallback } from 'react';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, keymap, ViewUpdate, placeholder as cmPlaceholder } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Note } from '../../types';

// Annotation to mark external content syncs so history does not merge them
// into the user's local undo stack.
const remoteSyncAnnotation = Annotation.define<boolean>();

const darkTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#E8E0D0' },
  '.cm-content': { caretColor: '#E8E0D0', fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit', padding: '0' },
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
  { tag: tags.monospace, fontFamily: '"JetBrains Mono", monospace', color: '#C9AA72', background: '#3D382820' },
  { tag: tags.link, color: '#C9AA72', textDecoration: 'underline' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.processingInstruction, tags.meta], color: '#9A908060', fontFamily: '"JetBrains Mono", monospace' },
  { tag: tags.quote, fontStyle: 'italic', color: '#9A9080' },
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
  editPaneRef: React.RefObject<HTMLDivElement | null>;
  maxWidth: number;
}

export function useCodeMirror({
  containerRef,
  note,
  isDark,
  onUpdate,
  onMentionTrigger,
  editPaneRef,
  maxWidth,
}: UseCodeMirrorOptions) {
  const editorViewRef = useRef<EditorView | null>(null);
  const savedCursorRef = useRef<number>(0);

  // Keep callback refs stable so the CodeMirror instance never captures stale closures
  const onUpdateRef = useRef(onUpdate);
  const onMentionTriggerRef = useRef(onMentionTrigger);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
  useEffect(() => { onMentionTriggerRef.current = onMentionTrigger; }, [onMentionTrigger]);

  // Build CodeMirror instance — recreate only when note id or dark mode changes
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged) {
        const content = update.state.doc.toString();
        onUpdateRef.current(content);

        const cursor = update.state.selection.main.head;
        const textBefore = content.slice(0, cursor);
        const match = textBefore.match(/\[\[([^\]]*)$/);
        if (match) {
          const coords = update.view.coordsAtPos(cursor);
          const pane = editPaneRef.current;
          let x = 32, y = 32;
          if (coords && pane) {
            const rect = pane.getBoundingClientRect();
            x = Math.max(0, Math.min(coords.left - rect.left, rect.width - 270));
            y = Math.min(coords.bottom - rect.top + 4, rect.height - 200);
          }
          onMentionTriggerRef.current({ query: match[1].toLowerCase(), index: match.index!, x, y });
        } else {
          onMentionTriggerRef.current(null);
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
    ]);

    const contentWidthTheme = EditorView.theme({
      '.cm-content': { maxWidth: `${maxWidth}px`, margin: '0 auto', boxSizing: 'border-box', paddingRight: '2rem' },
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
      contentWidthTheme,
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

    return () => {
      savedCursorRef.current = view.state.selection.main.head;
      view.destroy();
      editorViewRef.current = null;
    };
  }, [note?.id, isDark, maxWidth]);

  // Sync external content changes without destroying undo history
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !note) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== note.content) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: note.content },
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

  return { editorViewRef, insertFormatting, jumpToLine, insertMention };
}
