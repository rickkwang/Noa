import Fuse, { type FuseResult } from 'fuse.js';
import { Note } from '../types';

export interface ParsedQuery {
  tags: string[];
  exactPhrases: string[];
  keywords: string[];
}

export const parseQuery = (queryString: string, caseSensitive: boolean = false): ParsedQuery => {
  const tags: string[] = [];
  const exactPhrases: string[] = [];
  const keywords: string[] = [];
  const normalize = (s: string) => caseSensitive ? s : s.toLowerCase();

  // Extract tags: tag:#xxx or tag:xxx
  let currentQuery = queryString.replace(/tag:(#?[\w\u4e00-\u9fa5]+)/gi, (_, tag) => {
    tags.push(normalize(tag.replace('#', '')));
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

  return { tags, exactPhrases, keywords };
};

export interface SearchResult {
  note: Note;
  titleSnippet: string;
  contentSnippet: string;
}

export class SearchEngine {
  private fuse: Fuse<Note>;
  private notes: Note[];
  private caseSensitive: boolean;
  private fuzzySearch: boolean;
  private notesVersion: number;
  private cache: Map<string, SearchResult[]>;

  constructor(notes: Note[], caseSensitive: boolean = false, fuzzySearch: boolean = true) {
    this.notes = notes;
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

  public updateNotes(notes: Note[], caseSensitive?: boolean, fuzzySearch?: boolean) {
    this.notes = notes;
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

    const { tags, exactPhrases, keywords } = parseQuery(queryString, isCaseSensitive);

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

    const mappedResults = results.map(result => {
      const titleMatch = result.matches?.find((match) => match.key === 'title');
      const contentMatch = result.matches?.find((match) => match.key === 'content');

      return {
        note: result.item,
        titleSnippet: titleMatch ? this.highlightFuseMatch(result.item.title, titleMatch.indices as readonly [number, number][]) : this.highlightExact(result.item.title, exactPhrases, isCaseSensitive),
        contentSnippet: contentMatch ? this.getFuseSnippet(result.item.content, contentMatch.indices as readonly [number, number][]) : this.getSnippet(result.item.content, exactPhrases, isCaseSensitive),
      };
    });
    this.cache.set(cacheKey, mappedResults);
    return mappedResults;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private highlightExact(text: string, phrases: string[], caseSensitive: boolean = false): string {
    if (phrases.length === 0) return this.escapeHtml(text);
    let highlighted = this.escapeHtml(text);
    phrases.forEach(phrase => {
      const flags = caseSensitive ? 'g' : 'gi';
      const escapedPhrase = this.escapeHtml(phrase);
      const regex = new RegExp(`(${escapedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, flags);
      highlighted = highlighted.replace(regex, '<mark class="bg-[#B89B5E]/30 text-[#B89B5E] font-bold rounded-sm px-0.5">$1</mark>');
    });
    return highlighted;
  }

  private getSnippet(content: string, phrases: string[], caseSensitive: boolean = false): string {
    if (phrases.length === 0) return content.slice(0, 120) + '...';

    const normalizedContent = caseSensitive ? content : content.toLowerCase();
    let bestIndex = -1;

    for (const phrase of phrases) {
      const idx = normalizedContent.indexOf(phrase);
      if (idx !== -1) {
        bestIndex = idx;
        break;
      }
    }

    if (bestIndex === -1) return content.slice(0, 120) + '...';

    const start = Math.max(0, bestIndex - 40);
    const end = Math.min(content.length, bestIndex + 80);
    const snippet = (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '');

    return this.highlightExact(snippet, phrases, caseSensitive);
  }

  private highlightFuseMatch(text: string, indices: readonly [number, number][]): string {
    let result = '';
    let lastIndex = 0;

    indices.forEach(([start, end]) => {
      result += this.escapeHtml(text.slice(lastIndex, start));
      result += `<mark class="bg-[#B89B5E]/30 text-[#B89B5E] font-bold rounded-sm px-0.5">${this.escapeHtml(text.slice(start, end + 1))}</mark>`;
      lastIndex = end + 1;
    });
    result += this.escapeHtml(text.slice(lastIndex));
    return result;
  }

  private getFuseSnippet(content: string, indices: readonly [number, number][]): string {
    if (indices.length === 0) return content.slice(0, 120) + '...';

    const [firstMatchStart] = indices[0];
    const start = Math.max(0, firstMatchStart - 40);
    const end = Math.min(content.length, firstMatchStart + 80);
    
    let snippet = content.slice(start, end);
    
    // Adjust indices for the snippet
    const adjustedIndices = indices
      .filter(([s, e]) => s >= start && e < end)
      .map(([s, e]) => [s - start, e - start] as [number, number]);

    snippet = this.highlightFuseMatch(snippet, adjustedIndices);
    
    return (start > 0 ? '...' : '') + snippet + (end < content.length ? '...' : '');
  }
}
