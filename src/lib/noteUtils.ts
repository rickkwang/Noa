import { Note } from '../types';

// Replaces fenced code blocks (``` ... ```) and inline code spans (`...`)
// with spaces of equal length. Indented (4-space) code blocks are NOT stripped —
// they're indistinguishable from nested list content without a full parse.
// Keeping byte length stable
// means downstream regex match indices (unused here, but useful for future
// callers) remain valid. Links/tags inside code must not pollute refs.
const stripCodeSpans = (content: string): string => {
  let out = content.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length));
  out = out.replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
  return out;
};

export const extractLinks = (content: string): string[] => {
  const sanitized = stripCodeSpans(content);
  const matches = Array.from(sanitized.matchAll(/\[\[(.*?)\]\]/g));
  return Array.from(new Set(matches.map(m => {
    const raw = m[1];
    // Strip alias: [[Note|display]] → "Note"
    const pipeIdx = raw.indexOf('|');
    const withoutAlias = pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw;
    // Strip heading/block anchor: [[Note#Heading]] / [[Note#^block]] → "Note"
    const hashIdx = withoutAlias.indexOf('#');
    const target = hashIdx >= 0 ? withoutAlias.slice(0, hashIdx) : withoutAlias;
    return target.trim();
  }).filter(Boolean)));
};

/**
 * Slice the section of `content` under the heading whose text matches `heading`
 * (case-insensitive), from that heading line up to (excluding) the next heading
 * of the same or higher level. Returns null when the heading is not found.
 * Used by note embeds: ![[Note#Heading]].
 */
export const sliceHeadingSection = (content: string, heading: string): string | null => {
  const wanted = heading.trim().toLowerCase();
  const lines = content.split('\n');
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && m[2].trim().toLowerCase() === wanted) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
};

// CJK Unified Ideographs + CJK Ext-A + Hiragana + Katakana + Hangul Syllables.
// Broader than before which only covered basic CJK (\u4e00-\u9fa5).
const TAG_CHAR = '\\w\\u3040-\\u309f\\u30a0-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af';
const TAG_REGEX = new RegExp(
  `(?:^|(?<=\\s))#([${TAG_CHAR}]+(?:\\/[${TAG_CHAR}]+)*)(?![${TAG_CHAR}#\\/])`,
  'g',
);
export const extractTags = (content: string): string[] => {
  const sanitized = stripCodeSpans(content);
  const matches = Array.from(sanitized.matchAll(TAG_REGEX));
  return Array.from(new Set(matches.map(m => m[1])));
};

export const buildTitleToIdsMap = (notes: Array<Pick<Note, 'id' | 'title'>>): Map<string, string[]> => {
  const titleToIds = new Map<string, string[]>();
  notes.forEach((note) => {
    const list = titleToIds.get(note.title) ?? [];
    list.push(note.id);
    titleToIds.set(note.title, list);
  });
  return titleToIds;
};

export const computeLinkRefs = (note: Note, titleToIds: Map<string, string[]>): string[] => {
  const refs: string[] = [];
  (note.links ?? []).forEach((title) => {
    const ids = titleToIds.get(title);
    // Include all matching notes — even when there are duplicates.
    // Previously ids.length === 1 was required, silently dropping links
    // whenever two notes shared a title.
    if (ids) ids.forEach(id => refs.push(id));
  });
  return Array.from(new Set(refs));
};

export const recomputeLinkRefsForNotes = (notes: Note[]): Note[] => {
  const titleToIds = buildTitleToIdsMap(notes);
  return notes.map((note) => ({
    ...note,
    linkRefs: computeLinkRefs(note, titleToIds),
  }));
};

export const recomputeLinkRefsForSubset = (notes: Note[], targetIds: Set<string>): Note[] => {
  if (targetIds.size === 0) return notes;
  const titleToIds = buildTitleToIdsMap(notes);
  return notes.map((note) => {
    if (!targetIds.has(note.id)) return note;
    return {
      ...note,
      linkRefs: computeLinkRefs(note, titleToIds),
    };
  });
};

export const computeTopologySignature = (
  notes: Array<Pick<Note, 'id' | 'title' | 'links' | 'linkRefs'> & Partial<Pick<Note, 'tags'>>>
): string => {
  // 32-bit FNV-1a style hash to avoid large string allocations on every render.
  let hash = 0x811c9dc5;
  const addString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };

  // Terminate every value with \u0000 and every list field with \u0001 so
  // boundaries stay unambiguous — otherwise id "ab" + title "c" hashes
  // identically to id "a" + title "bc", and a value moving between
  // links/linkRefs/tags is invisible to the signature.
  const addValue = (value: string) => {
    addString(value);
    addString('\u0000');
  };
  const endField = () => addString('\u0001');

  notes.forEach((note) => {
    addValue(note.id);
    addValue(note.title);
    (note.links ?? []).forEach(addValue);
    endField();
    (note.linkRefs ?? []).forEach(addValue);
    endField();
    (note.tags ?? []).forEach(addValue);
    endField();
    hash ^= 0x9e3779b9;
  });

  return String(hash >>> 0);
};

// Notes that link INTO `activeNote` — via resolved linkRefs (preferred) or a
// title match in raw links (legacy fallback). Single source of truth shared by
// the Backlinks panel and its tab badge so the count never drifts from the list.
export const getBacklinks = (activeNote: Note | undefined, notes: Note[]): Note[] => {
  if (!activeNote) return [];
  return notes.filter(n =>
    n.id !== activeNote.id &&
    ((n.linkRefs ?? []).includes(activeNote.id) || (n.links ?? []).includes(activeNote.title))
  );
};
