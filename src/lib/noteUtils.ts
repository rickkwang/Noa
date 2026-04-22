import { Note } from '../types';

// Replaces fenced code blocks (``` ... ```), indented code blocks, and inline
// code spans (`...`) with spaces of equal length. Keeping byte length stable
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
  notes: Array<Pick<Note, 'id' | 'title' | 'links' | 'linkRefs'>>
): string => {
  // 32-bit FNV-1a style hash to avoid large string allocations on every render.
  let hash = 0x811c9dc5;
  const addString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };

  notes.forEach((note) => {
    addString(note.id);
    addString(note.title);
    (note.links ?? []).forEach(addString);
    (note.linkRefs ?? []).forEach(addString);
    hash ^= 0x9e3779b9;
  });

  return String(hash >>> 0);
};
