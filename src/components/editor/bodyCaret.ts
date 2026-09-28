// Where writing starts in a note that was just opened to be written in: the
// first still-empty task line if the template left one, else the end. A task
// line saved without its trailing space (older daily notes, or an editor that
// trims whitespace) gets one, or the first keystroke lands flush against `]`.
export function bodyCaretTarget(doc: string): { anchor: number; insert?: string } {
  const match = /^[ \t]*[-*+] \[ \]([ \t]*)$/m.exec(doc);
  if (!match) return { anchor: doc.length };
  const lineEnd = match.index + match[0].length;
  return match[1] ? { anchor: lineEnd } : { anchor: lineEnd + 1, insert: ' ' };
}
