import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface FindReplacePanelProps {
  editorViewRef: React.RefObject<EditorView | null>;
  isDark: boolean;
  onClose: () => void;
}

interface Match {
  from: number;
  to: number;
}

function findAllMatches(doc: string, query: string, caseSensitive: boolean, useRegex: boolean): Match[] {
  if (!query) return [];
  try {
    const flags = caseSensitive ? 'g' : 'gi';
    const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(pattern, flags);
    const matches: Match[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(doc)) !== null) {
      matches.push({ from: m.index, to: m.index + m[0].length });
      // Guard against zero-width matches causing infinite loops
      if (m[0].length === 0) re.lastIndex++;
    }
    return matches;
  } catch {
    return [];
  }
}

export function FindReplacePanel({ editorViewRef, isDark, onClose }: FindReplacePanelProps) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matches, setMatches] = useState<Match[]>([]);
  const [regexError, setRegexError] = useState(false);

  const findInputRef = useRef<HTMLInputElement>(null);

  // Focus the find input when panel opens
  useEffect(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  // Recompute matches whenever search params change
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const doc = view.state.doc.toString();

    if (!findText) {
      setMatches([]);
      setCurrentIndex(0);
      setRegexError(false);
      // Clear decorations
      view.dispatch({ effects: [] });
      return;
    }

    try {
      if (useRegex) new RegExp(findText); // validate
      setRegexError(false);
    } catch {
      setRegexError(true);
      setMatches([]);
      return;
    }

    const found = findAllMatches(doc, findText, caseSensitive, useRegex);
    setMatches(found);
    setCurrentIndex(prev => Math.min(prev, Math.max(0, found.length - 1)));
  }, [findText, caseSensitive, useRegex, editorViewRef]);

  // Scroll to current match
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || matches.length === 0) return;
    const match = matches[currentIndex];
    if (!match) return;
    view.dispatch({
      selection: { anchor: match.from, head: match.to },
      scrollIntoView: true,
    });
    view.focus();
  }, [currentIndex, matches, editorViewRef]);

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex(i => (i + 1) % matches.length);
  }, [matches.length]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex(i => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const replaceOne = useCallback(() => {
    const view = editorViewRef.current;
    if (!view || matches.length === 0) return;
    const match = matches[currentIndex];
    if (!match) return;

    let insertText = replaceText;
    if (useRegex) {
      try {
        const flags = caseSensitive ? '' : 'i';
        const re = new RegExp(findText, flags);
        const original = view.state.doc.sliceString(match.from, match.to);
        insertText = original.replace(re, replaceText);
      } catch { /* fallback to literal */ }
    }

    view.dispatch({
      changes: { from: match.from, to: match.to, insert: insertText },
      selection: { anchor: match.from + insertText.length },
    });
    view.focus();
    // matches will recompute via the effect
  }, [editorViewRef, matches, currentIndex, replaceText, findText, caseSensitive, useRegex]);

  const replaceAll = useCallback(() => {
    const view = editorViewRef.current;
    if (!view || matches.length === 0) return;

    // Build changes in reverse order so positions stay valid
    const changes = [...matches].reverse().map(m => {
      let insertText = replaceText;
      if (useRegex) {
        try {
          const flags = caseSensitive ? '' : 'i';
          const re = new RegExp(findText, flags);
          const original = view.state.doc.sliceString(m.from, m.to);
          insertText = original.replace(re, replaceText);
        } catch { /* fallback */ }
      }
      return { from: m.from, to: m.to, insert: insertText };
    });

    view.dispatch({ changes });
    view.focus();
  }, [editorViewRef, matches, replaceText, findText, caseSensitive, useRegex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) goPrev(); else goNext();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [goNext, goPrev, onClose]);

  const bg = isDark ? '#1E1E1C' : '#EAE8E0';
  const border = isDark ? '#3A3A37' : '#2D2D2D';
  const text = isDark ? '#F0EDE6' : '#2D2D2D';
  const inputBg = isDark ? '#2A2A28' : '#DCD9CE';
  const mutedText = isDark ? 'rgba(240,237,230,0.45)' : 'rgba(45,45,45,0.5)';
  const accent = isDark ? '#D97757' : '#B89B5E';

  return (
    <div
      className="shrink-0 border-b font-redaction text-xs"
      style={{ background: bg, borderColor: border, color: text }}
    >
      {/* Find row */}
      <div className="flex items-center gap-1 px-3 py-1.5">
        {/* expand/collapse replace */}
        <button
          onClick={() => setShowReplace(v => !v)}
          title={showReplace ? 'Hide replace' : 'Show replace'}
          className="shrink-0 p-0.5 hover:opacity-70 active:opacity-50"
          style={{ color: mutedText }}
        >
          {showReplace ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>

        {/* find input */}
        <input
          ref={findInputRef}
          value={findText}
          onChange={e => { setFindText(e.target.value); setCurrentIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Find…"
          className="flex-1 min-w-0 outline-none px-2 py-0.5 text-xs font-redaction"
          style={{
            background: inputBg,
            color: regexError ? '#D97757' : text,
            border: `1px solid ${regexError ? '#D97757' : border}`,
          }}
          spellCheck={false}
        />

        {/* match count */}
        <span className="shrink-0 tabular-nums" style={{ color: mutedText, minWidth: '3rem', textAlign: 'center' }}>
          {matches.length === 0
            ? (findText ? '0 / 0' : '')
            : `${currentIndex + 1} / ${matches.length}`}
        </span>

        {/* Aa case */}
        <button
          onClick={() => setCaseSensitive(v => !v)}
          title="Case sensitive"
          className="shrink-0 px-1 py-0.5 border font-bold uppercase tracking-wider"
          style={{
            borderColor: caseSensitive ? accent : border,
            color: caseSensitive ? accent : mutedText,
            background: 'transparent',
          }}
        >
          Aa
        </button>

        {/* .* regex */}
        <button
          onClick={() => setUseRegex(v => !v)}
          title="Regular expression"
          className="shrink-0 px-1 py-0.5 border font-bold"
          style={{
            borderColor: useRegex ? accent : border,
            color: useRegex ? accent : mutedText,
            background: 'transparent',
          }}
        >
          .*
        </button>

        {/* prev / next */}
        <button onClick={goPrev} disabled={matches.length === 0} title="Previous (Shift+Enter)"
          className="shrink-0 p-0.5 disabled:opacity-30 hover:opacity-70">
          <ChevronUp size={13} />
        </button>
        <button onClick={goNext} disabled={matches.length === 0} title="Next (Enter)"
          className="shrink-0 p-0.5 disabled:opacity-30 hover:opacity-70">
          <ChevronDown size={13} />
        </button>

        <button onClick={onClose} title="Close (Esc)" className="shrink-0 p-0.5 hover:opacity-70 ml-1">
          <X size={13} />
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="flex items-center gap-1 px-3 pb-1.5">
          {/* spacer to align with find input */}
          <div className="w-[18px] shrink-0" />

          <input
            value={replaceText}
            onChange={e => setReplaceText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
            placeholder="Replace…"
            className="flex-1 min-w-0 outline-none px-2 py-0.5 text-xs font-redaction"
            style={{ background: inputBg, color: text, border: `1px solid ${border}` }}
            spellCheck={false}
          />

          <button
            onClick={replaceOne}
            disabled={matches.length === 0}
            className="shrink-0 border px-2 py-0.5 uppercase tracking-wider font-bold text-[10px] disabled:opacity-30 hover:opacity-80 active:opacity-60"
            style={{ borderColor: border, color: text, background: 'transparent' }}
          >
            Replace
          </button>
          <button
            onClick={replaceAll}
            disabled={matches.length === 0}
            className="shrink-0 border px-2 py-0.5 uppercase tracking-wider font-bold text-[10px] disabled:opacity-30 hover:opacity-80 active:opacity-60"
            style={{ borderColor: border, color: text, background: 'transparent' }}
          >
            All
          </button>
        </div>
      )}
    </div>
  );
}
