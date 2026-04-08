# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev             # Dev server at http://localhost:3000
npm run lint            # Type check only (tsc --noEmit) — run this before every commit
npm run test:unit       # Vitest unit tests (all 10 test files, ~91 tests)
npm run test:unit:watch # Watch mode
npm run build:budget    # Production build + JS bundle size guard (entry <400 KB, chunks <1.3 MB)
npm run check:structure # Architecture boundary guard — prevents App layer importing FS modules
npm run clean           # Remove dist/

# Run a single test file
npx vitest run tests/unit/search.test.ts

# Desktop (Electron)
npm run desktop:dev     # Dev with Electron
BUILD_TARGET=desktop npx electron-builder --mac dmg zip --arm64  # Release build (set "publish": null in package.json first)
```

CI gates: `lint` → `check:structure` → `build:budget` → `test:unit`

## Architecture

**Noa** is a fully client-side Markdown note-taking app (React 19 + Vite + Tailwind CSS v4). No backend — all data lives in IndexedDB (via localforage) and optionally synced to the local filesystem via the File System Access API.

### Layer Rules (enforced by `check:structure`)

```
App.tsx (orchestration only)
  └── Hooks (domain logic)
        ├── useNotes       — note/folder CRUD, auto-save (500 ms debounce), link extraction
        ├── useFileSync    — FS sync state machine: idle | syncing | ready | error
        ├── useDataTransfer — import/export/backup workflows
        ├── useSettings    — AppSettings persisted to localStorage
        └── useLayout      — panel widths, open state, focus mode, tab state
  └── Services (low-level FS only)
        └── fileSyncService — all File System Access API primitives
```

`App.tsx` must not import from `src/lib/storage.ts` or `src/services/fileSyncService.ts` directly.

### Data Flow

- `src/lib/storage.ts` — localforage (IndexedDB) wrapper; four stores: notes, folders, workspace, attachments
- `src/lib/noteUtils.ts` — `extractLinks` / `extractTags` / `computeLinkRefs` — shared by `useNotes` and `useDataTransfer`; do not duplicate inline
- `src/core/search.ts` — `SearchEngine` (Fuse.js); supports `tag:`, `in:folder`, `before:`, `after:`, `"exact phrase"` operators; Fuse instance rebuilt only on `caseSensitive` change, otherwise uses `setCollection()`
- `src/lib/taskParser.ts` — parses `- [ ]` / `- [x]` with priority emoji and due date from note content
- `src/lib/frontmatter.ts` — `parseFrontmatter` / `stringifyFrontmatter` for YAML key:value blocks

### Editor Stack

- `Editor.tsx` — thin orchestrator; all logic delegated to `src/components/editor/`
- `useCodeMirror.ts` — CodeMirror 6 instance; recreated only on `note.id` or `isDark` change; external content updates use `buildMinimalReplaceChange` to preserve undo history; width changes use `Compartment.reconfigure()` to avoid rebuild
- `PreviewPane.tsx` — `React.memo` wrapped; react-markdown with remark-gfm, remark-math, rehype-highlight, rehype-katex; custom `blockquote` component handles `[!NOTE]`/`[!WARNING]`/`[!TIP]`/`[!IMPORTANT]`/`[!CAUTION]` callouts
- `SlashCommandDropdown.tsx` — `/` trigger; 12 built-in commands including table, divider, callout

### State Persistence

| What | Where |
|------|-------|
| Notes, folders, attachments | IndexedDB (`redaction-diary-*-db`) |
| Settings | `localStorage` key `app-settings` |
| Open tabs | `localStorage` key `redaction-diary-open-tabs` |
| Panel widths, sidebar/right state | `localStorage` (see `STORAGE_KEYS` in `src/constants/storageKeys.ts`) |
| Note sort order | `localStorage` key `app-note-sort-order` |

All `localStorage` reads/writes must be wrapped in try/catch — quota exceeded throws synchronously.

### Styling Constraints

- Tailwind CSS v4 — no `tailwind.config.js`; light mode design tokens: bg `#EAE8E0`, secondary bg `#DCD9CE`, accent `#B89B5E`, text `#2D2D2D`
- Dark mode tokens: bg `#262624`, secondary bg `#1E1E1C`, text `#F0EDE6`, accent `#D97757`
- Dark mode is driven by `data-theme="dark"` on `<html>` (set by `ThemeInjector`); overrides live in `src/index.css` as `[data-theme="dark"] .class { ... !important }` — this beats Tailwind's specificity reliably
- `ThemeInjector` must render **before** the `isLoaded` guard in App.tsx so dark mode applies during the loading skeleton
- Components without `isDark` logic rely entirely on CSS overrides in `index.css` — add new color overrides there, not in JS-injected `<style>` tags
- For colors that differ from the Tailwind class (e.g. border color in dark mode), use inline `style={}` props rather than fighting CSS specificity
- No `rounded-full`; all interactive elements need `active:opacity-70`
- No `window.alert` / `confirm` / `prompt` — use inline UI patterns
- No `rehypeRaw` in PreviewPane (security constraint)

### Key Patterns

**Avoiding stale closures in useCallback/useEffect:**
Use `useRef` to hold the latest value rather than adding it to the dependency array. Pattern used in `useNotes`, `useCodeMirror.ts` keymaps, and `useResizeDrag.ts` (stores `isDragging`/`getValue` in refs to prevent listener re-registration loop).

**useResizeDrag:**
Listeners are registered once per drag session (`isDragging` → true). Mutable values (`min`, `max`, `getValue`) are read via refs inside the listener to avoid the dependency-loop problem.

**Tab fusion (active tab bottom border):**
Container uses `after:` pseudo-element for the bottom line; active tab uses `z-[1]` + `background` to cover it. `overflow-x: auto` collapses `overflow-y: visible` to `auto` — avoid `overflow-x: auto` on the tab strip container.

**Multi-tab state:**
`openTabIds: string[]` lives in `App.tsx`, derived `openTabs` (id+title) via `useMemo` with a `Map` for O(1) lookup. `handleDeleteNote` in `App.tsx` removes the tab and computes fallback before delegating to `useNotes._handleDeleteNote` — `useNotes` does not own tab-aware fallback.

**Folder expand animation:**
Uses `grid-template-rows: 0fr → 1fr` transition (not `max-height`) for natural height animation. Outer div has `display: grid` + transition; inner div has `overflow-hidden`.

**Vault sync folder structure:**
`scanDirectory` in `fileSystemStorage.ts` dynamically creates `Folder` records for vault subdirectories not yet in Noa. `mergeScannedNotes` returns `{ notes, newFolders }`; callers must merge `newFolders` into the existing folder list before calling `onImportData`.

**React.memo usage:**
`FileNode` (Sidebar) and `PreviewPane` are memo-wrapped. Components with significant internal state (Sidebar, TopBar, RightPanel) are not memo-wrapped — the comparison overhead would outweigh the benefit.

### Release

```bash
# Set "publish": null in package.json, then:
BUILD_TARGET=desktop npx electron-builder --mac dmg zip --arm64
gh release upload <tag> release/Noa-<version>-arm64.dmg release/Noa-<version>-arm64-mac.zip
# Restore publish config after
```
