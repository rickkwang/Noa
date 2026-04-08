import { Note } from '../types';

export const extractLinks = (content: string): string[] => {
  const matches = Array.from(content.matchAll(/\[\[(.*?)\]\]/g));
  return Array.from(new Set(matches.map(m => {
    const raw = m[1];
    const pipeIdx = raw.indexOf('|');
    return (pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw).trim();
  })));
};

export const extractTags = (content: string): string[] => {
  const matches = Array.from(content.matchAll(/(?:^|(?<=\s))#([\w\u4e00-\u9fa5]+(?:\/[\w\u4e00-\u9fa5]+)*)(?![\w\u4e00-\u9fa5#\/])/g));
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
    if (ids && ids.length === 1) refs.push(ids[0]);
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
