import { Folder, Note } from '../types';

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

// Tolerantly decode percent-escapes (Obsidian URL-encodes markdown link
// targets, e.g. %20 for spaces). Runs of valid %XX sequences decode together
// so multi-byte UTF-8 works; malformed escapes (a literal "%泄") are left as-is.
export const decodeLinkPath = (raw: string): string =>
  raw.replace(/(?:%[0-9a-fA-F]{2})+/g, (seq) => {
    try { return decodeURIComponent(seq); } catch { return seq; }
  });

const HREF_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Extract the note target from a markdown link destination — Obsidian treats
 * `[text](path/Note.md)` as an internal link. Returns the decoded target
 * (anchor stripped, `.md` kept) or null when the destination is external
 * (has a scheme), an in-page anchor, or not a `.md` file.
 */
export const parseMarkdownLinkTarget = (rawHref: string): string | null => {
  let href = rawHref.trim();
  if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1).trim();
  if (!href || href.startsWith('#') || HREF_SCHEME_RE.test(href)) return null;
  const withoutAnchor = href.split('#')[0];
  const decoded = decodeLinkPath(withoutAnchor).trim();
  if (!/\.md$/i.test(decoded)) return null;
  return decoded;
};

export const extractLinks = (content: string): string[] => {
  const sanitized = stripCodeSpans(content);
  const targets = new Set<string>();

  Array.from(sanitized.matchAll(/\[\[(.*?)\]\]/g)).forEach((m) => {
    const raw = m[1];
    // Strip alias: [[Note|display]] → "Note". Inside Markdown tables Obsidian
    // escapes the pipe ([[Note\|display]]) — drop the trailing backslash too.
    const pipeIdx = raw.indexOf('|');
    const withoutAlias = (pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw).replace(/\\+$/, '');
    // Strip heading/block anchor: [[Note#Heading]] / [[Note#^block]] → "Note"
    const hashIdx = withoutAlias.indexOf('#');
    const target = (hashIdx >= 0 ? withoutAlias.slice(0, hashIdx) : withoutAlias).trim();
    if (target) targets.add(target);
  });

  // Markdown-style internal links: [text](Note.md), [text](./folder/Note.md).
  // The wikilink pass above can't match these (no ]( inside [[...]]).
  Array.from(sanitized.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)).forEach((m) => {
    let dest = m[1].trim();
    // Optional "title" suffix: [text](Note.md "tooltip"). Encoded targets
    // contain no spaces; <>-wrapped targets may.
    if (!dest.startsWith('<')) dest = dest.split(/\s/)[0];
    const target = parseMarkdownLinkTarget(dest);
    if (target) targets.add(target);
  });

  return Array.from(targets);
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

// ── Obsidian-aligned link resolution ─────────────────────────────────────────
// Wikilinks resolve the way Obsidian resolves file paths: case-insensitively,
// tolerating a trailing ".md", treating [[Folder/Note]] as an exact path, and
// picking a SINGLE target for duplicate titles — root-level note first, then a
// stable (folder name, id) order. Resolution never depends on where the
// linking note lives (Obsidian is deliberately source-independent).

const lowerKey = (value: string): string => value.trim().toLowerCase();

// Dedup key for link targets: case-insensitive with one trailing ".md"
// stripped, so [[foo]] and [[Foo.md]] collapse to the same target.
export const normalizeLinkKey = (raw: string): string => {
  const key = lowerKey(raw);
  return key.endsWith('.md') ? key.slice(0, -3) : key;
};

interface LinkCandidate {
  id: string;
  folderId: string;
}

export interface LinkIndex {
  byTitle: Map<string, LinkCandidate[]>;
  folderKeyToIds: Map<string, Set<string>>;
  folderIdToKey: Map<string, string>;
}

export const buildLinkIndex = (
  notes: Array<Pick<Note, 'id' | 'title' | 'folder'>>,
  folders: Array<Pick<Folder, 'id' | 'name'>> = [],
): LinkIndex => {
  const byTitle = new Map<string, LinkCandidate[]>();
  notes.forEach((note) => {
    const key = lowerKey(note.title);
    const list = byTitle.get(key) ?? [];
    list.push({ id: note.id, folderId: note.folder ?? '' });
    byTitle.set(key, list);
  });
  const folderKeyToIds = new Map<string, Set<string>>();
  const folderIdToKey = new Map<string, string>();
  folders.forEach((folder) => {
    const key = lowerKey(folder.name);
    const ids = folderKeyToIds.get(key) ?? new Set<string>();
    ids.add(folder.id);
    folderKeyToIds.set(key, ids);
    folderIdToKey.set(folder.id, key);
  });
  return { byTitle, folderKeyToIds, folderIdToKey };
};

// Duplicate titles: root-level note wins ([[A]] resolves to /A.md over
// Folder/A.md no matter where the link is written); remaining ties break by
// stable (folder name, id) order so resolution is deterministic.
const pickCandidate = (candidates: LinkCandidate[], index: LinkIndex): string => {
  if (candidates.length === 1) return candidates[0].id;
  const rootCandidates = candidates.filter((candidate) => candidate.folderId === '');
  const pool = rootCandidates.length > 0 ? rootCandidates : candidates;
  const ranked = [...pool].sort((a, b) => {
    const folderA = index.folderIdToKey.get(a.folderId) ?? '';
    const folderB = index.folderIdToKey.get(b.folderId) ?? '';
    if (folderA !== folderB) return folderA < folderB ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return ranked[0].id;
};

// Apply "." / ".." dir segments on top of a (normalized) base folder path.
// Returns the resulting normalized path ('' = vault root), or null when ".."
// escapes above the vault root.
const resolveRelativeDir = (baseDir: string, dirSegments: string[]): string | null => {
  const out = baseDir ? baseDir.split('/') : [];
  for (const segment of dirSegments) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(lowerKey(segment));
  }
  return out.join('/');
};

export const resolveLinkTarget = (rawTarget: string, index: LinkIndex, sourceFolderId?: string): string | null => {
  const segments = rawTarget.split('/').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  const basename = segments[segments.length - 1];
  if (basename === '.' || basename === '..') return null;
  const dirSegments = segments.slice(0, -1);

  // Exact (case-insensitive) title lookup runs before ".md" stripping, so a
  // note literally titled "Note.md" beats "Note" for [[Note.md]].
  const candidates = index.byTitle.get(lowerKey(basename))
    ?? index.byTitle.get(normalizeLinkKey(basename))
    ?? [];
  if (candidates.length === 0) return null;

  if (dirSegments.length === 0) return pickCandidate(candidates, index);

  // Path link. Obsidian tries the vault-absolute path first, then the path
  // relative to the linking note's folder (absolute has higher precedence);
  // a leading "./" or "../" forces relative-only. No basename fallback — a
  // path that matches nothing stays unresolved.
  const isExplicitRelative = dirSegments[0] === '.' || dirSegments[0] === '..';
  const sourceDir = sourceFolderId ? (index.folderIdToKey.get(sourceFolderId) ?? '') : '';
  const dirPathsToTry: Array<string | null> = [];
  if (!isExplicitRelative) {
    dirPathsToTry.push(dirSegments.map(lowerKey).join('/'));
  }
  if (sourceFolderId !== undefined) {
    dirPathsToTry.push(resolveRelativeDir(sourceDir, dirSegments));
  }

  for (const dirPath of dirPathsToTry) {
    if (dirPath === null) continue;
    const filtered = dirPath === ''
      ? candidates.filter((candidate) => candidate.folderId === '')
      : (() => {
          const folderIds = index.folderKeyToIds.get(dirPath);
          return folderIds ? candidates.filter((candidate) => folderIds.has(candidate.folderId)) : [];
        })();
    if (filtered.length > 0) return pickCandidate(filtered, index);
  }
  return null;
};

export const computeLinkRefs = (note: Note, index: LinkIndex): string[] => {
  const refs = new Set<string>();
  (note.links ?? []).forEach((target) => {
    const id = resolveLinkTarget(target, index, note.folder ?? '');
    if (id) refs.add(id);
  });
  return Array.from(refs);
};

export const recomputeLinkRefsForNotes = (notes: Note[], folders: Array<Pick<Folder, 'id' | 'name'>> = []): Note[] => {
  const index = buildLinkIndex(notes, folders);
  return notes.map((note) => ({
    ...note,
    linkRefs: computeLinkRefs(note, index),
  }));
};

export const recomputeLinkRefsForSubset = (notes: Note[], targetIds: Set<string>, folders: Array<Pick<Folder, 'id' | 'name'>> = []): Note[] => {
  if (targetIds.size === 0) return notes;
  const index = buildLinkIndex(notes, folders);
  return notes.map((note) => {
    if (!targetIds.has(note.id)) return note;
    return {
      ...note,
      linkRefs: computeLinkRefs(note, index),
    };
  });
};

export const computeTopologySignature = (
  notes: Array<Pick<Note, 'id' | 'title' | 'links' | 'linkRefs'> & Partial<Pick<Note, 'tags' | 'folder'>>>,
  folders?: Array<Pick<Folder, 'id' | 'name'>>
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
    // Folder placement participates in link resolution ([[folder/Note]] paths,
    // root-priority disambiguation), so moving a note must change the signature.
    addValue(note.folder ?? '');
    (note.links ?? []).forEach(addValue);
    endField();
    (note.linkRefs ?? []).forEach(addValue);
    endField();
    (note.tags ?? []).forEach(addValue);
    endField();
    hash ^= 0x9e3779b9;
  });

  // Folder renames re-route path links without touching any note.
  (folders ?? []).forEach((folder) => {
    addValue(folder.id);
    addValue(folder.name);
    hash ^= 0x9e3779b9;
  });

  return String(hash >>> 0);
};

// Notes that link INTO `activeNote`, via resolved linkRefs. Every path into
// notes state (initial load, import, vault merge, every mutation) recomputes
// linkRefs with the shared resolver, so refs are authoritative — a raw-title
// fallback here would only add backlinks Obsidian doesn't show (duplicate
// titles resolve to ONE note; path links may resolve elsewhere). Single source
// of truth shared by the Backlinks panel and its tab badge.
export const getBacklinks = (activeNote: Note | undefined, notes: Note[]): Note[] => {
  if (!activeNote) return [];
  return notes.filter(n =>
    n.id !== activeNote.id && (n.linkRefs ?? []).includes(activeNote.id)
  );
};
