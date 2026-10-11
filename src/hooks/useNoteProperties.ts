import { useCallback, useMemo, useRef } from 'react';
import { splitFrontmatter } from '../lib/frontmatter';
import { parseProperties, type FrontmatterProperty } from '../lib/frontmatterProperties';
import { Note } from '../types';

interface NotePropertiesWriters {
  /** Replaces the note body (Noa notes keep frontmatter there). */
  onUpdate?: (content: string) => void;
  /** Writes a vault/imported note's out-of-band frontmatter (`note.rawFrontmatter`). */
  onFrontmatterChange?: (rawFrontmatter: string | undefined) => void;
}

// Noa notes keep frontmatter in the body; vault/imported notes keep it out of
// band in rawFrontmatter so the vault file round-trips byte-for-byte.
const keepsFrontmatterOutOfBand = (note: Note) =>
  note.rawFrontmatter !== undefined || note.origin === 'vault' || (note.source ?? 'noa') !== 'noa';

export function useNoteProperties(note: Note | undefined, allNotes: Note[], { onUpdate, onFrontmatterChange }: NotePropertiesWriters) {
  const frontmatter = useMemo(() => {
    if (!note) return null;
    const { rawBlock, body, eol } = splitFrontmatter(note.content);
    if (eol) return { inContent: true as const, block: rawBlock, body, eol, exists: true };
    if (keepsFrontmatterOutOfBand(note)) {
      return { inContent: false as const, block: note.rawFrontmatter ?? '', exists: Boolean(note.rawFrontmatter?.trim()) };
    }
    // No frontmatter yet: the first property creates a body block.
    return { inContent: true as const, block: '', body: note.content, eol: '\n' as const, exists: false };
  }, [note]);

  const onChange = useCallback((block: string) => {
    if (!frontmatter) return;
    if (frontmatter.inContent) {
      const { body, eol } = frontmatter;
      onUpdate?.(block.trim() ? `---${eol}${block}${eol}---${eol}${body}` : body);
    } else {
      onFrontmatterChange?.(block.trim() ? block : undefined);
    }
  }, [frontmatter, onFrontmatterChange, onUpdate]);

  const canWrite = frontmatter ? (frontmatter.inContent ? Boolean(onUpdate) : Boolean(onFrontmatterChange)) : false;

  // Every property key in the workspace, with a sample value so Add property can show (and keep) its type.
  // Built on demand: allNotes changes on every keystroke, and only Add property needs this.
  const allNotesRef = useRef(allNotes);
  allNotesRef.current = allNotes;
  const getSuggestions = useCallback(() => {
    // Built-in properties lead the list even before any note uses them.
    const byKey = new Map<string, FrontmatterProperty>(
      ['aliases', 'cssclasses', 'tags'].map((key) => [key, { key, value: [], editable: true }]),
    );
    for (const item of allNotesRef.current) {
      const block = item.content.startsWith('---') ? splitFrontmatter(item.content).rawBlock : item.rawFrontmatter;
      if (!block) continue;
      for (const prop of parseProperties(block)) {
        const known = byKey.get(prop.key);
        // Prefer a non-empty sample: an empty value can't tell text from date.
        if (!known || (known.value === '' && prop.value !== '')) byKey.set(prop.key, prop);
      }
    }
    return [...byKey.values()];
  }, []);

  return { frontmatter, onChange, canWrite, getSuggestions };
}
