# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Start dev server at http://localhost:3000
npm run build      # Production build
npm run lint       # Type check (tsc --noEmit)
npm run clean      # Remove dist/
```

No test framework is configured.

## Architecture

**Noa** is a fully client-side Markdown note-taking app (React 19 + Vite + Tailwind CSS v4). All data is stored in the browser — no backend.

### State & Data Flow

- `App.tsx` composes three custom hooks that own all state:
  - `useNotes` (`src/hooks/useNotes.ts`) — notes/folders CRUD, daily notes, import/export; exposes `recentNoteIds` (localStorage, max 10); all note-activation calls go through `setActiveNoteIdWithRecent` to keep history in sync
  - `useSettings` (`src/hooks/useSettings.ts`) — `AppSettings` persisted to `localStorage`
  - `useLayout` (`src/hooks/useLayout.ts`) — sidebar/right-panel widths, view modes, mobile detection; `activeRightTab` (`'tasks'|'backlinks'|'graph'`, persisted to `app-right-tab`); `openGraphView()` helper opens right panel and switches to graph tab
- `src/lib/storage.ts` wraps **localforage** (IndexedDB) for notes and folders. Settings use plain `localStorage`. A one-time migration from `localStorage` → localforage runs on startup.

### Core Types (`src/types.ts`)

| Type | Purpose |
|------|---------|
| `Note` | id, title, content (Markdown), folder, tags, links |
| `Folder` | id, name |
| `GlobalTask` | parsed `[ ]`/`[x]` checkbox from note content |
| `AppSettings` | editor, appearance, filesAndLinks, dailyNotes, search, corePlugins, advanced |

### Key Components

- `Editor.tsx` — CodeMirror 6 editor + react-markdown preview, supports edit/preview/split modes; includes TOC outline panel (parsed from `# ## ###` headings, click to jump via CodeMirror `scrollIntoView`)
- `Sidebar.tsx` — file tree with folder/note management, search results, recent notes list (top 10, persisted to `localStorage`), and tags explorer; delete uses inline `pendingDelete` confirm bar (no `window.confirm`)
- `RightPanel.tsx` — three-tab panel: **Tasks**, **Backlinks**, **Graph**; tab state is controlled (passed from `App.tsx` via `activeTab`/`onTabChange`); Graph tab has upper graph window (55% height, with border + filter input) and lower `GraphInfoPanel` (stats: note count, link count, isolated nodes, active note connections, top-5 most connected)
- `GraphView.tsx` — embedded knowledge graph via `react-force-graph-2d` + `d3-force`; accepts external `width`/`height`; Obsidian-style rendering: isolated nodes gray, connected nodes accent color, active note gets glow ring + border; degree-based node sizing (`3 + sqrt(degree)*1.2`); labels only at `globalScale >= 1.2`; drag fixes node position via `fx/fy`; `zoomToFit(300, 24)` auto-fires 600ms after `graphData` changes; `graphData` depends on topology-only key (id/title/links) to avoid re-simulation on content edits; d3 forces configured via ref: `charge -40`, `link distance 30`, `forceCollide(radius+6)`
- `ThemeInjector.tsx` — injects CSS variables from settings (accent color, font, max-width)
- `SearchEngine` (`src/core/search.ts`) — Fuse.js with custom query parser supporting `tag:`, `"exact phrase"`, and keyword AND matching
- `DataSettings.tsx` — import/export; JSON import validates required note fields (`id, title, content, createdAt, updatedAt`) and uses inline confirm/feedback UI (no `alert`/`confirm`/`prompt`); New Workspace uses inline input inside confirm box; ZIP/HTML export buttons show loading state

### Styling Conventions

- Tailwind CSS v4 (configured via `@tailwindcss/vite` plugin, no `tailwind.config.js`)
- Design tokens: background `#EAE8E0`, accent `#B89B5E`, text `#2D2D2D`
- Font: Redaction 50 (`font-redaction`) as default, Work Sans as secondary
- Search highlights use inline `<mark>` with Tailwind arbitrary classes

### Wiki Links

Notes support `[[Note Title]]` wiki-link syntax. `useNotes` parses these to populate `note.links`. `handleNavigateToNote` resolves a title to a note id.

In Preview mode, `[[X]]` is replaced with raw HTML `<a data-note-title="X" href="#">X</a>` before passing to react-markdown (processed via `rehypeRaw`). The custom `a` component detects `data-note-title` and renders a clickable span — this avoids non-standard `note://` protocol being stripped by rehype.

### Storage Key Conventions

IndexedDB instance names (via localforage): `redaction-diary-notes-db`, `redaction-diary-folders-db`, `redaction-diary-workspace-db`, `redaction-diary-fs-db`. (Storage keys retain the original prefix for backwards compatibility with existing user data.) localStorage keys use `app-` prefix (e.g. `app-sidebar-open`, `app-right-tab`). `redaction-storage-notice-seen` marks that the one-time data-safety toast has been dismissed.

### Layout Defaults

- Left sidebar: default=min=**280px**, max=480px
- Right panel: default=min=**320px**, max=480px
- Both panels: `useResizeDrag` hook, widths do NOT go below their minimum to prevent content overlap

### Native Dialog Policy

**Never use `window.alert`, `window.confirm`, or `window.prompt`.** All confirmations use inline UI patterns:
- Delete confirmation: `pendingDelete` state in `Sidebar.tsx`, renders a confirm bar above the header
- Destructive action confirmation: `confirmState` in `DataSettings.tsx`, renders inline warning box with optional `<input>` field

### Feature Inventory (v1.2)

| Feature | Location |
|---------|---------|
| Recent notes list | `useNotes.recentNoteIds` → `Sidebar.tsx` (above Tags Explorer) |
| Backlinks panel | `RightPanel.tsx` Backlinks tab; receives `activeNote` + `allNotes` from `App.tsx` |
| TOC outline | `Editor.tsx` toolbar button (`AlignLeft`); floating panel, click jumps to heading line |
| Import validation | `DataSettings.tsx` — checks 5 required fields, inline confirm/error UI |
| Export loading | `DataSettings.tsx` — `exportingZip` / `exportingHtml` state, spinner + disabled button |
| Wiki link preview | `Editor.tsx` — raw HTML injection + `data-note-title` attribute pattern |
| Inline delete confirm | `Sidebar.tsx` — `pendingDelete` state, no native dialogs |
| New Workspace input | `DataSettings.tsx` — `confirmState.inputValue` pattern, no `window.prompt` |
| Graph panel | `RightPanel.tsx` Graph tab; `GraphView.tsx` embedded with `width`/`height` props; `GraphInfoPanel` shows stats + active note connections + top-5 ranked nodes; TopBar Network button calls `openGraphView()`; filter input has direct-angle border (`border border-[#2D2D2D]/50`, no `rounded`); tabs use `flex-1 justify-center` to fill panel width on resize |
| Welcome screen | `Editor.tsx` empty state — keyboard shortcut guide + brand info + data safety note; shown when no note is active |
| Storage safety toast | `App.tsx` — one-time notice on first visit, dismissed state saved to `redaction-storage-notice-seen` in localStorage |
