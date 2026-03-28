# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install             # Install dependencies
npm run dev             # Start dev server at http://localhost:3000
npm run build           # Production build
npm run lint            # Type check (tsc --noEmit)
npm run build:budget    # Production build + JS bundle budget guard
npm run check:structure # Architecture boundary guard (App-layer import checks)
npm run test:unit       # Vitest unit tests (dataIntegrity, taskParser, search, dataTransfer)
npm run test:smoke      # Playwright smoke tests
npm run clean           # Remove dist/
```

## Architecture

**Redaction Diary** is a fully client-side Markdown note-taking app (React 19 + Vite + Tailwind CSS v4). All data is stored in the browser — no backend.

### State & Data Flow

- `App.tsx` is an orchestration layer (UI composition only) and composes these hooks:
  - `useNotes` (`src/hooks/useNotes.ts`) — note/folder/task domain state + persistence bridge
  - `useSettings` (`src/hooks/useSettings.ts`) — app settings persisted to `localStorage`
  - `useLayout` (`src/hooks/useLayout.ts`) — panel width/open state, mobile state, active right tab
  - `useFileSync` (`src/hooks/useFileSync.ts`) — File System sync state machine + connect/disconnect/retry
  - `useGlobalShortcuts` (`src/hooks/useGlobalShortcuts.ts`) — global keyboard behavior (`Cmd/Ctrl+N/F/S`, Escape)
- `src/lib/storage.ts` wraps **localforage** (IndexedDB) for notes/folders/workspace.
- `src/services/fileSyncService.ts` centralizes low-level FS sync primitives and error classification.

### Sync State Machine

- Type: `SyncStatus = 'idle' | 'syncing' | 'ready' | 'error'` (`src/types.ts`)
- Owned by `useFileSync`; UI consumes status only.
- Recovery contract: when status is `error`, retry action is always available and idempotent (`retryFullSync`).

### Data Transfer (Import/Export)

- `useDataTransfer` (`src/hooks/useDataTransfer.ts`) owns import/export/connect/disconnect workflows.
- `exportJsonSnapshot(notes, folders, workspaceName)` is also exported as a **pure function** from the same file; `App.tsx` calls it directly for quick backup (no hook instantiation needed).
- `markExported()` in `src/lib/exportTimestamp.ts` dispatches a `redaction-exported` custom event; `useBackupReminder` listens to it via `useState` + event handler (no per-render localStorage reads).
- `DataSettings.tsx` is a thin shell for:
  - feedback message bus
  - inline confirm dialog state
  - wiring transfer actions to section components
- DataSettings split sections:
  - `WorkspaceSection.tsx`
  - `BackupSection.tsx`
  - `ImportSection.tsx`
- Integrity checks are centralized in `src/lib/dataIntegrity.ts` and enforced before import/export actions.

### Core Types (`src/types.ts`)

| Type | Purpose |
|------|---------|
| `Note` | id, title, content (Markdown), folder, tags, links |
| `Folder` | id, name |
| `GlobalTask` | parsed `[ ]`/`[x]` checkbox from note content |
| `AppSettings` | editor, appearance, dailyNotes, search, corePlugins |
| `SyncStatus` | `idle` / `syncing` / `ready` / `error` |

### Key Components

- `Editor.tsx` — CodeMirror 6 editor + Markdown preview, supports edit/preview/split; TOC outline panel and mention insertion; multi-tab support (rounded tab bar, `+` new tab)
- `Sidebar.tsx` — folder/note tree, search, recent notes, tag explorer; inline delete confirmation (no native dialogs)
- `RightPanel.tsx` — tabs for Tasks / Backlinks / Graph; graph search uses deferred value to reduce render pressure
- `GraphView.tsx` — force-directed knowledge graph with topology-only memoization key, degree-based node sizing, and auto `zoomToFit`
- `ThemeInjector.tsx` — injects CSS variables from settings

### Multi-Tab State

- `openTabIds: string[]` lives in `App.tsx`; synced via `useEffect` whenever `activeNoteId` changes.
- `openTabs` (id + title) is derived with `useMemo` and passed to `Editor` as `tabs` prop.
- Tab actions: `handleTabChange` (switch), `handleTabClose` (close + auto-focus adjacent), `handleNewTab` (create note).
- `Editor` accepts optional `tabs`, `onTabChange`, `onTabClose`, `onNewTab` props; falls back to single-tab legacy mode when `tabs` is empty/undefined.
- Active tab uses `rounded-t-lg border border-b-0` + `marginBottom: '-1px'` to fuse with the bottom border line.
- Tab bar header is `h-8` to align with Sidebar and RightPanel headers.

### Styling Conventions

- Tailwind CSS v4 (via `@tailwindcss/vite`, no `tailwind.config.js`)
- Design tokens: background `#EAE8E0`, accent `#B89B5E`, text `#2D2D2D`
- Font: Redaction 50 default (`font-redaction`), Work Sans secondary

### Wiki Links

Notes use `[[Note Title]]` syntax.

- Link graph extraction still parses `[[...]]` in note content.
- Preview no longer relies on raw HTML injection. It rewrites `[[X]]` into a safe internal markdown link (`note-internal://...`) and handles navigation in custom `a` renderer.

### Security Constraints

- Do **not** use `rehypeRaw` for note preview rendering.
- Export HTML is safe-by-default (escape + allowlisted URL protocols).
- Never introduce `window.alert`, `window.confirm`, or `window.prompt`; use inline UI patterns.

### Storage Keys

- IndexedDB names:
  - `redaction-diary-notes-db`
  - `redaction-diary-folders-db`
  - `redaction-diary-workspace-db`
  - `redaction-diary-fs-db`
- localStorage examples:
  - `app-sidebar-open`, `app-right-tab`, `app-editor-view-mode`
  - `redaction-storage-notice-seen`
  - `redaction-diary-recent-notes`

### Layout Defaults

- Left sidebar min width: **280px** (max 480px)
- Right panel min width: **320px** (max 480px)
- Resize logic via `useResizeDrag`; widths never drop below min constraints

### Design Conventions

- No `rounded-full` anywhere — all corners are square or `rounded-t-lg` (tabs only), consistent with retro aesthetic.
- All interactive buttons must have `active:opacity-70` for press feedback.
- No `window.alert`, `window.confirm`, `window.prompt` — use inline UI patterns.
- Mention autocomplete dropdown position: computed from `view.coordsAtPos(cursor)` relative to `editPaneRef`, prevents overflow on the right edge.

### Architecture Guardrails

- `App.tsx` must not import low-level FS modules directly.
- Use hook/service boundaries:
  - App layer orchestrates
  - Hooks coordinate domain behavior
  - Service layer performs low-level FS operations
- `useFileSync`: `notesRef`/`foldersRef`/`workspaceNameRef` keep latest values; `retry` and bootstrap effect use refs to avoid stale closures.
- CI checks:
  - `lint`
  - `check:structure`
  - `build:budget`
  - `test:smoke`

See `docs/architecture-boundaries.md` for boundary details.
