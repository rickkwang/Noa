import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { SYSTEM_DEFAULT_FONT, isSafeFontFamilyName, resolveFontFamily } from '../../lib/fontFamily';
import { Check, ChevronDown, Search } from '@/src/lib/icons';

const SYSTEM_DEFAULT_LABEL = 'System Default';

function readStoredFonts(): string[] | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEYS.SYSTEM_FONTS) ?? 'null');
    return Array.isArray(parsed) && parsed.every((name) => typeof name === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

// Seeded from the last session so the picker opens with its list already in place.
let cachedSystemFonts: string[] | null = readStoredFonts();
let systemFontsPromise: Promise<string[]> | null = null;

interface LocalFontData {
  family: string;
}

function loadSystemFonts(): Promise<string[]> {
  if (systemFontsPromise) return systemFontsPromise;

  const api = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  if (typeof api !== 'function') return Promise.resolve([]);

  systemFontsPromise = api()
    .then((fonts) => {
      // One entry per face: collapse to families, and drop names unsafe for CSS (e.g. macOS's hidden ".AppleSystemUIFont").
      const families = Array.from(new Set(fonts.map((font) => font.family)))
        .filter(isSafeFontFamilyName)
        .sort((a, b) => a.localeCompare(b));
      cachedSystemFonts = families;
      try { localStorage.setItem(STORAGE_KEYS.SYSTEM_FONTS, JSON.stringify(families)); } catch { /* quota exceeded */ }
      return families;
    })
    .finally(() => { systemFontsPromise = null; });
  return systemFontsPromise;
}

interface FontOption {
  value: string;
  label: string;
}

interface FontPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export default function FontPicker({ value, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // The list is filtered by `filter`, which only changes on Enter, so typing doesn't reshuffle the rows under the cursor.
  const [filter, setFilter] = useState('');
  const [systemFonts, setSystemFonts] = useState<string[]>(() => cachedSystemFonts ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const didLoad = useRef(false);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  // Enumerate only on open: queryLocalFonts() raises a permission prompt, which shouldn't fire just from viewing the tab.
  const ensureFontsLoaded = useCallback(() => {
    if (didLoad.current || cachedSystemFonts) return;
    didLoad.current = true;
    setLoading(true);
    loadSystemFonts()
      .then(setSystemFonts)
      .catch((err: unknown) => {
        // A denied permission is a deliberate user choice, not a failure worth
        // reporting; anything else is surfaced so the empty list is explained.
        const message = err instanceof Error ? err.message : String(err);
        if (!message.toLowerCase().includes('permission')) {
          setError('Could not read the fonts installed on this device.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const options = useMemo((): FontOption[] => {
    const list: FontOption[] = [{ value: SYSTEM_DEFAULT_FONT, label: SYSTEM_DEFAULT_LABEL }];
    // Keep the active font selectable even if it's missing from enumeration (API unavailable, or font uninstalled).
    if (value !== SYSTEM_DEFAULT_FONT && !systemFonts.includes(value)) {
      list.push({ value, label: value });
    }
    for (const family of systemFonts) list.push({ value: family, label: family });
    return list;
  }, [systemFonts, value]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, filter]);

  // Keep the highlight on the selected row when the list opens, and inside
  // bounds as filtering shrinks it.
  useEffect(() => {
    setActiveIndex((current) => {
      if (filtered.length === 0) return 0;
      return Math.min(current, filtered.length - 1);
    });
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const index = filtered.findIndex((option) => option.value === value);
    setActiveIndex(index >= 0 ? index : 0);
    // Only when the popup opens; later filtering is handled by the clamp above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // Scroll the highlighted row into view for keyboard navigation.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openPicker = useCallback(() => {
    ensureFontsLoaded();
    setQuery('');
    setFilter('');
    setOpen(true);
  }, [ensureFontsLoaded]);

  const closePicker = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const select = useCallback((next: string) => {
    onChange(next);
    closePicker(true);
  }, [closePicker, onChange]);

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + delta + filtered.length) % filtered.length);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, filtered.length - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // First Enter applies the typed query; once applied, Enter picks the highlighted font.
      if (query.trim() !== filter.trim()) {
        setFilter(query);
        setActiveIndex(0);
        return;
      }
      const option = filtered[activeIndex];
      if (option) select(option.value);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closePicker(true);
      return;
    }
    if (event.key === 'Tab') closePicker(false);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  };

  const currentLabel = value === SYSTEM_DEFAULT_FONT ? SYSTEM_DEFAULT_LABEL : value;

  return (
    <div ref={rootRef} className="relative inline-block max-w-xs">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Font family"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => (open ? closePicker(false) : openPicker())}
        onKeyDown={onTriggerKeyDown}
        className={`flex items-center max-w-full border border-[#2D2D2B] rounded-chip pl-3 pr-9 py-1.5 text-sm font-medium text-left outline-none relative hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)] ${open ? 'bg-[var(--bg-sidebar-raised,#ECEBE8)]' : 'bg-[var(--bg-primary,#F9F9F7)]'}`}
      >
        <span className="min-w-0 truncate">{currentLabel}</span>
        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#2D2D2B]/70" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 z-50 bg-[#F9F9F7] rounded-panel noa-floating-panel overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--divider-subtle)]">
            <Search size={13} className="shrink-0 text-[var(--text-secondary)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Search fonts…"
              aria-label="Search fonts"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={filtered[activeIndex] ? `${baseId}-option-${activeIndex}` : undefined}
              role="combobox"
              aria-expanded
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-secondary)]"
            />
          </div>

          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label="Fonts"
            // both-edges mirrors the scrollbar gutter so row highlights sit on equal whitespace each side.
            className="max-h-64 overflow-y-auto [scrollbar-gutter:stable_both-edges] py-1"
          >
            {filtered.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <li key={option.value} role="presentation">
                  <button
                    type="button"
                    id={`${baseId}-option-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    // Select on click, not pointerdown, which would race the outside-click listener.
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(option.value)}
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${isActive ? 'noa-ink-selected' : ''}`}
                    style={{ fontFamily: resolveFontFamily(option.value) }}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected && <Check size={13} className="shrink-0 text-[#CC7D5E]" />}
                  </button>
                </li>
              );
            })}

            {filtered.length === 0 && (
              <li role="presentation" className="px-2 py-2 text-xs text-[#2D2D2B]/50">
                {loading ? 'Reading installed fonts…' : 'No matching fonts.'}
              </li>
            )}
          </ul>

          {/* A stored list is already usable, so only a first-ever read shows progress. */}
          {(error || (loading && systemFonts.length === 0)) && filtered.length > 0 && (
            <div className="px-3 py-1.5 border-t border-[var(--divider-subtle)] text-caption text-[#2D2D2B]/50">
              {error ?? 'Reading installed fonts…'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
