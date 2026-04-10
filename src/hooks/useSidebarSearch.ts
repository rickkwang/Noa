import { useState, useEffect, useRef, useDeferredValue } from 'react';
import { Note, Folder } from '../types';
import { SearchEngine, SearchResult } from '../core/search';

interface UseSidebarSearchOptions {
  notes: Note[];
  folders: Folder[];
  searchQuery: string;
  caseSensitive: boolean;
  fuzzySearch: boolean;
}

export function useSidebarSearch({
  notes,
  folders,
  searchQuery,
  caseSensitive,
  fuzzySearch,
}: UseSidebarSearchOptions): SearchResult[] {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchEngineRef = useRef<SearchEngine | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rebuild index when notes/settings change (debounced).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!searchEngineRef.current) {
        searchEngineRef.current = new SearchEngine(notes, caseSensitive, fuzzySearch, folders);
      } else {
        searchEngineRef.current.updateNotes(notes, caseSensitive, fuzzySearch, folders);
      }
      if (searchEngineRef.current && deferredSearchQuery) {
        setSearchResults(searchEngineRef.current.search(deferredSearchQuery, caseSensitive));
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [notes, folders, caseSensitive, fuzzySearch]); // intentionally excludes deferredSearchQuery

  // Re-run search when query changes.
  useEffect(() => {
    if (!searchEngineRef.current) return;
    setSearchResults(searchEngineRef.current.search(deferredSearchQuery, caseSensitive));
  }, [deferredSearchQuery, caseSensitive]);

  return searchResults;
}
