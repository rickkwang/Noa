# CLAUDE.md

## Commands

```bash
npm run dev             # Dev server at http://localhost:3000
npm run lint            # Type check only (tsc --noEmit) — run before every commit
npm run test:unit       # Vitest unit tests
npm run build:budget    # Production build + bundle size guard
npm run check:structure # Architecture boundary guard
```

CI gates: `lint` → `check:structure` → `build:budget` → `test:unit`

## Architecture

**Noa** — client-side Markdown notes app (React 19 + Vite + Tailwind CSS v4). No backend; data in IndexedDB, optionally mirrored to local filesystem via File System Access API.

```
App.tsx (orchestration only)
  └── Hooks: useNotes · useFileSync · useDataTransfer · useSettings · useLayout
  └── Services: fileSyncService (File System Access API primitives)
```

`App.tsx` must not import `src/lib/storage.ts` or `src/services/fileSyncService.ts` directly.

## Key Files

- `src/lib/storage.ts` — localforage (IndexedDB) wrapper
- `src/lib/noteUtils.ts` — `extractLinks` / `extractTags` / `computeLinkRefs` — do not duplicate inline
- `src/core/search.ts` — `SearchEngine` (Fuse.js); `tag:`, `in:folder`, `before:`, `after:`, `"exact phrase"`
- `src/lib/taskParser.ts` — parses `- [ ]` / `- [x]` syntax
- `src/lib/frontmatter.ts` — `parseFrontmatter` / `stringifyFrontmatter`
- `src/constants/storageKeys.ts` — all localStorage keys

## Editor Stack

- `useCodeMirror.ts` — recreated only on `note.id` / `isDark` change; width uses `Compartment.reconfigure()`
- `PreviewPane.tsx` — `React.memo`; rehype-highlight for code, custom blockquote for callouts
- `SlashCommandDropdown.tsx` — `/` trigger, 12 built-in commands

## Styling

- Light: bg `#EAE8E0`, secondary `#DCD9CE`, accent `#B89B5E`, text `#2D2D2D`
- Dark: bg `#262624`, secondary `#1E1E1C`, accent `#D97757`, text `#F0EDE6`
- Dark mode via `data-theme="dark"` on `<html>` (set by `ThemeInjector`); overrides in `src/index.css` as `[data-theme="dark"] .class { !important }` — beats Tailwind specificity
- `ThemeInjector` must render **before** the `isLoaded` guard to avoid flash-of-wrong-theme
- Use inline `style={}` when a color must differ from its Tailwind class in dark mode
- No `rounded-full`; all interactive elements need `active:opacity-70`
- No `window.alert/confirm/prompt`; no `rehypeRaw` in PreviewPane

## Key Patterns

- **Stale closures**: use `useRef` to hold latest values instead of adding to dependency arrays (`useNotes`, `useCodeMirror` keymaps, `useResizeDrag`)
- **useResizeDrag**: listeners registered once per drag; `min/max/getValue` read via refs inside handler to avoid re-registration loop
- **Folder expand animation**: `grid-template-rows: 0fr → 1fr` transition, not `max-height`
- **Vault sync**: `scanDirectory` creates missing `Folder` records on the fly; `mergeScannedNotes` returns `{ notes, newFolders }` — callers must merge before `onImportData`
- **React.memo**: `FileNode` and `PreviewPane` are wrapped; stateful components (Sidebar, TopBar, RightPanel) are not
- **localStorage**: all reads/writes must be in try/catch — quota exceeded throws synchronously
- **Tab state**: `openTabIds` in App.tsx; `openTabs` derived via `useMemo` with a `Map` for O(1) lookup

## Release

```bash
# Set "publish": null in package.json first
BUILD_TARGET=desktop npx electron-builder --mac dmg zip --arm64
gh release upload <tag> release/Noa-<version>-arm64.dmg release/Noa-<version>-arm64-mac.zip
```
