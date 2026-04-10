import Fuse, { type FuseResult } from 'fuse.js';
import { Folder, Note } from '../types';

export interface ParsedQuery {
  tags: string[];
  exactPhrases: string[];
  keywords: string[];
  folder?: string;
  before?: Date;
  after?: Date;
}

export const parseQuery = (queryString: string, caseSensitive: boolean = false): ParsedQuery => {
  const tags: string[] = [];
  const exactPhrases: string[] = [];
  const keywords: string[] = [];
  const normalize = (s: string) => caseSensitive ? s : s.toLowerCase();
  let folder: string | undefined;
  let before: Date | undefined;
  let after: Date | undefined;

  // Extract tags: tag:#xxx or tag:xxx
  let currentQuery = queryString.replace(/tag:(#?[\w\u4e00-\u9fa5]+)/gi, (_, tag) => {
    tags.push(normalize(tag.replace('#', '')));
    return '';
  });

  // Extract in:folder operator
  currentQuery = currentQuery.replace(/\bin:([\w\u4e00-\u9fa5/\-_.]+)/gi, (_, f) => {
    folder = normalize(f);
    return '';
  });

  // Extract before:/after: operators
  // Parse as local time (not UTC) so the date boundary matches what the user typed.
  currentQuery = currentQuery.replace(/\bbefore:(\d{4}-\d{2}-\d{2})\b/gi, (_, d) => {
    const [y, mo, day] = d.split('-').map(Number);
    before = new Date(y, mo - 1, day, 23, 59, 59, 999);
    return '';
  });
  currentQuery = currentQuery.replace(/\bafter:(\d{4}-\d{2}-\d{2})\b/gi, (_, d) => {
    const [y, mo, day] = d.split('-').map(Number);
    after = new Date(y, mo - 1, day, 0, 0, 0, 0);
    return '';
  });

  // Extract exact phrases: "xxx"
  currentQuery = currentQuery.replace(/"([^"]+)"/g, (_, phrase) => {
    exactPhrases.push(normalize(phrase));
    return '';
  });

  // Extract keywords
  currentQuery.split(/\s+/).forEach(word => {
    if (word.trim()) {
      keywords.push(normalize(word));
    }
  });

  return { tags, exactPhrases, keywords, folder, before, after };
};

export interface SearchResult {
  note: Note;
  titleSnippet: string;
  contentSnippet: string;
}

const CACHE_MAX_SIZE = 100;

export class SearchEngine {
  private fuse: Fuse<Note>;
  private notes: Note[];
  private folders: Folder[];
  private caseSensitive: boolean;
  private fuzzySearch: boolean;
  private notesVersion: number;
  private cache: Map<string, SearchResult[]>;

  constructor(notes: Note[], caseSensitive: boolean = false, fuzzySearch: boolean = true, folders: Folder[] = []) {
    this.notes = notes;
    this.folders = folders;
    this.caseSensitive = caseSensitive;
    this.fuzzySearch = fuzzySearch;
    this.notesVersion = 1;
    this.cache = new Map();
    this.fuse = new Fuse(notes, {
      keys: ['title', 'content'],
      includeMatches: true,
      threshold: 0.3,
      ignoreLocation: true,
      useExtendedSearch: true,
      isCaseSensitive: caseSensitive,
    });
  }

  public updateNotes(notes: Note[], caseSensitive?: boolean, fuzzySearch?: boolean, folders?: Folder[]) {
    this.notes = notes;
    if (folders !== undefined) this.folders = folders;
    if (fuzzySearch !== undefined) this.fuzzySearch = fuzzySearch;
    if (caseSensitive !== undefined && caseSensitive !== this.caseSensitive) {
      this.caseSensitive = caseSensitive;
      this.fuse = new Fuse(notes, {
        keys: ['title', 'content'],
        includeMatches: true,
        threshold: 0.3,
        ignoreLocation: true,
        useExtendedSearch: true,
        isCaseSensitive: caseSensitive,
      });
    } else {
      this.fuse.setCollection(notes);
    }
    this.notesVersion += 1;
    this.cache.clear();
  }

  public search(queryString: string, caseSensitive?: boolean): SearchResult[] {
    const isCaseSensitive = caseSensitive ?? this.caseSensitive;
    const normalize = (s: string) => isCaseSensitive ? s : s.toLowerCase();
    const cacheKey = `${this.notesVersion}|${isCaseSensitive ? 1 : 0}|${this.fuzzySearch ? 1 : 0}|${queryString}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!queryString.trim()) {
      const allResults = this.notes.map(note => ({
        note,
        titleSnippet: note.title,
        contentSnippet: this.getSnippet(note.content, []),
      }));
      this.cache.set(cacheKey, allResults);
      return allResults;
    }

    const { tags, exactPhrases, keywords, folder, before, after } = parseQuery(queryString, isCaseSensitive);

    let results: FuseResult<Note>[] = [];

    if (keywords.length > 0) {
      if (this.fuzzySearch) {
        // Fuse extended search syntax: 'word1 'word2 for AND match
        const fuseQuery = keywords.map(k => `'${k}`).join(' ');
        results = this.fuse.search(fuseQuery);
      } else {
        // Exact substring match
        results = this.notes
          .filter(note =>
            keywords.every(kw =>
              normalize(note.title).includes(kw) || normalize(note.content).includes(kw)
            )
          )
          .map((note) => ({ item: note } as FuseResult<Note>));
      }
    } else {
      results = this.notes.map((note) => ({ item: note } as FuseResult<Note>));
    }

    // Filter by tags first (strict match)
    if (tags.length > 0) {
      results = results.filter(({ item }) =>
        tags.every(tag => item.tags?.map(t => normalize(t)).includes(tag))
      );
    }

    // Filter by exact phrases (strict match)
    if (exactPhrases.length > 0) {
      results = results.filter(({ item }) =>
        exactPhrases.every(phrase =>
          normalize(item.title).includes(phrase) ||
          normalize(item.content).includes(phrase)
        )
      );
    }

    // Filter by in:folder
    if (folder && this.folders.length > 0) {
      const matchedFolder = this.folders.find(f => normalize(f.name) === folder);
      if (matchedFolder) {
        results = results.filter(({ item }) => item.folder === matchedFolder.id);
      }
    }

    // Filter by before:/after: (based on updatedAt)
    if (before) {
      results = results.filter(({ item }) => new Date(item.updatedAt) <= before!);
    }
    if (after) {
      results = results.filter(({ item }) => new Date(item.updatedAt) >= after!);
    }

    const mappedResults = results.map(result => {
      const titleMatch = result.matches?.find((match) => match.key === 'title');
      const contentMatch = result.matches?.find((match) => match.key === 'content');

      return {
        note: result.item,
        titleSnippet: titleMatch ? this.highlightFuseMatch(result.item.title, titleMatch.indices as readonly [number, number][]) : this.highlightExact(result.item.title, exactPhrases, isCaseSensitive),
        contentSnippet: contentMatch ? this.getFuseSnippet(result.item.content, contentMatch.indices as readonly [number, number][]) : this.getSnippet(result.item.content, exactPhrases, isCaseSensitive),
      };
    });
    // Evict oldest entry when cache exceeds limit to bound memory usage.
    if (this.cache.size >= CACHE_MAX_SIZE) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(cacheKey, mappedResults);
    return mappedResults;
  }

  private createBoldMarkers(source: string): { open: string; close: string } {
    let open = '[[__NOA_B_OPEN__]]';
    let close = '[[__NOA_B_CLOSE__]]';
    while (source.includes(open) || source.includes(close)) {
      open = `${open}_`;
      close = `${close}_`;
    }
    return { open, close };
  }

  // Snippets use plain <b>…</b> markers only. The Sidebar renders them via
  // HighlightedText which reconstructs React nodes — no raw HTML hits the DOM.
  private wrapBold(text: string, marker: { open: string; close: string }): string {
    return `${marker.open}${text}${marker.close}`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private finalizeSnippet(text: string, marker: { open: string; close: string }): string {
    return this.escapeHtml(text)
      .replaceAll(marker.open, '<b>')
      .replaceAll(marker.close, '</b>');
  }

  private highlightExact(text: string, phrases: string[], caseSensitive: boolean = false): string {
    const marker = this.createBoldMarkers(text);
    if (phrases.length === 0) return this.finalizeSnippet(text, marker);
    let highlighted = text;
    phrases.forEach(phrase => {
      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(`(${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, flags);
      highlighted = highlighted.replace(regex, (match) => this.wrapBold(match, marker));
    });
    return this.finalizeSnippet(highlighted, marker);
  }

  private getSnippet(content: string, phrases: string[], caseSensitive: boolean = false): string {
    if (phrases.length === 0) {
      if (!content.trim()) return '';
      const plainSnippet = content.slice(0, 120) + (content.length > 120 ? '...' : '');
      return this.finalizeSnippet(plainSnippet, this.createBoldMarkers(plainSnippet));
    }

    const normalizedContent = caseSensitive ? content : content.toLowerCase();
    let bestIndex = -1;

    for (const phrase of phrases) {
      const idx = normalizedContent.indexOf(phrase);
      if (idx !== -1) {
        bestIndex = idx;
        break;
      }
    }

    if (bestIndex === -1) {
      if (!content.trim()) return '';
      const plainSnippet = content.slice(0, 120) + (content.length > 120 ? '...' : '');
      return this.finalizeSnippet(plainSnippet, this.createBoldMarkers(plainSnippet));
    }

    const start = Math.max(0, bestIndex - 40);
    const end = Math.min(content.length, bestIndex + 80);
    const snippet = (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '');

    return this.highlightExact(snippet, phrases, caseSensitive);
  }

  private highlightFuseMatch(text: string, indices: readonly [number, number][]): string {
    const marker = this.createBoldMarkers(text);
    let result = '';
    let lastIndex = 0;

    indices.forEach(([start, end]) => {
      result += text.slice(lastIndex, start);
      result += this.wrapBold(text.slice(start, end + 1), marker);
      lastIndex = end + 1;
    });
    result += text.slice(lastIndex);
    return this.finalizeSnippet(result, marker);
  }

  private getFuseSnippet(content: string, indices: readonly [number, number][]): string {
    if (indices.length === 0) {
      if (!content.trim()) return '';
      const plainSnippet = content.slice(0, 120) + (content.length > 120 ? '...' : '');
      return this.finalizeSnippet(plainSnippet, this.createBoldMarkers(plainSnippet));
    }

    const [firstMatchStart] = indices[0];
    const start = Math.max(0, firstMatchStart - 40);
    const end = Math.min(content.length, firstMatchStart + 80);

    const adjustedIndices = indices
      .filter(([s, e]) => s >= start && e <= end)
      .map(([s, e]) => [s - start, e - start] as [number, number]);

    const snippet = this.highlightFuseMatch(content.slice(start, end), adjustedIndices);

    return (start > 0 ? '...' : '') + snippet + (end < content.length ? '...' : '');
  }
}
