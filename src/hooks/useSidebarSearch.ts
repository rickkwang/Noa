import { useState, useEffect, useRef, useDeferredValue, useCallback } from 'react';
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
  const indexStaleRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredSearchQueryRef = useRef(deferredSearchQuery);
  deferredSearchQueryRef.current = deferredSearchQuery;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  // Latest inputs for on-demand index builds — the Fuse index (title + full
  // content) is expensive, so it is only (re)built when a search is actually
  // running, never while the user is just typing in the editor.
  const inputsRef = useRef({ notes, folders, caseSensitive, fuzzySearch });
  inputsRef.current = { notes, folders, caseSensitive, fuzzySearch };

  const ensureFreshIndex = useCallback(() => {
    if (searchEngineRef.current && !indexStaleRef.current) return;
    const latest = inputsRef.current;
    if (!searchEngineRef.current) {
      searchEngineRef.current = new SearchEngine(latest.notes, latest.caseSensitive, latest.fuzzySearch, latest.folders);
    } else {
      searchEngineRef.current.updateNotes(latest.notes, latest.caseSensitive, latest.fuzzySearch, latest.folders);
    }
    indexStaleRef.current = false;
  }, []);

  // Mark the index stale whenever its inputs change; rebuild (debounced) only
  // while a search is active so live results keep tracking edits.
  useEffect(() => {
    indexStaleRef.current = true;
    if (!searchQuery) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (!searchQueryRef.current) {
        setSearchResults([]);
        return;
      }
      const latestQuery = deferredSearchQueryRef.current;
      if (!latestQuery) {
        setSearchResults([]);
        return;
      }
      ensureFreshIndex();
      setSearchResults(searchEngineRef.current!.search(latestQuery, inputsRef.current.caseSensitive));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
    };
  // Query changes do not invalidate the index; both raw and deferred query are
  // intentionally excluded so typing only reruns search against the same index.
  }, [notes, folders, caseSensitive, fuzzySearch, ensureFreshIndex]);

  // Clear pending work immediately when the real query is cleared; waiting for
  // the deferred value would leave a window where note edits can rebuild an
  // index the user is no longer using.
  useEffect(() => {
    if (searchQuery) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setSearchResults([]);
  }, [searchQuery]);

  // Re-run search when the query changes; first use builds the index on demand.
  useEffect(() => {
    // A query change supersedes any refresh scheduled under the previous query.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!deferredSearchQuery) {
      setSearchResults([]);
      return;
    }
    ensureFreshIndex();
    setSearchResults(searchEngineRef.current!.search(deferredSearchQuery, caseSensitive));
  }, [deferredSearchQuery, caseSensitive, ensureFreshIndex]);

  return searchResults;
}
