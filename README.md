# Noa

**Notes on Anything.** A local-first Markdown notebook that keeps your writing on your own device.

Noa has no accounts, no servers, and no cloud sync. Notes live in your browser's IndexedDB, or in a folder on your disk that you choose. It is built to be quick to write in on day one and still easy to maintain years later.

## Why Noa

- **Your data stays with you.** Nothing is uploaded. The only outbound requests are the update check and the issue link you click yourself (see [Privacy](#privacy-and-data)).
- **Plain Markdown on disk, if you want it.** Connect a folder and every note is a `.md` file you can open in any editor. Attachments go into an `attachments/` folder inside it.
- **Connected notes.** Wiki links, backlinks, a graph view, tags, and tasks gathered from every note.
- **Backups you can see.** Exports and automatic daily snapshots, with a health indicator that tells you how long it has been since your last export.

## Features

**Writing**
- CodeMirror 6 editor with edit, live preview, and split views
- GitHub-flavored Markdown: tables, task lists, footnotes, callouts
- Math (KaTeX) and diagrams (Mermaid), rendered inline
- Images pasted or dragged into a note (JPEG, PNG, GIF, WebP; up to 10 MB each)
- Daily notes from a customizable date format and template
- Light, dark, or system appearance

**Connecting**
- `[[Wiki links]]` with backlinks in the right panel
- Graph view of the whole note network
- Tag browser in the sidebar; click a tag to search for it
- Tasks from all notes collected into one panel; checking a task updates its source line

**Workspace**
- Use Noa's local storage, or connect a folder on disk as the active workspace
- Import an Obsidian vault folder once (frontmatter tags and links are preserved)
- Import and export as JSON, Vault ZIP, or static HTML

## Installation

### macOS app (Apple Silicon)

Download the latest `.dmg` from [Releases](https://github.com/rickkwang/Noa/releases).

> The current builds are **not code-signed or notarized**, so macOS may block the first launch. Only install builds from the official Releases page. The app checks for updates at startup and notifies you when one is available; you choose whether to download it.

### From source

Requires **Node.js 22** (see `.nvmrc`).

```bash
git clone https://github.com/rickkwang/Noa.git
cd Noa
npm install
npm run dev          # open http://localhost:3000
```

`npm install` also sets `core.hooksPath` to `.githooks/`, which enables the pre-push checks described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Guides

### Connect a folder as your workspace

Settings → Workspace → **Vault Folder**, then pick a folder.

- Creating and editing notes writes Markdown files into that folder.
- While connected, the sidebar shows only the folder's notes. Notes stored in Noa are hidden, not deleted, and return when you disconnect.
- Noa checks for outside changes when the window regains focus and every 60 seconds while it is visible. Click **Retry Sync** to check now. There is no file watcher, so changes made in another program appear with a short delay.
- Attachments for each note are stored in `attachments/<note>/` inside the folder.
- Deleting a note moves it to `.trash` inside the folder. Restore it with your file manager.
- Renames or moves that would break existing `[[links]]` are blocked. Make those changes in an editor that updates links, such as Obsidian.

Noa is not a two-way sync engine. Keep an independent backup of any folder you connect.

### Import an Obsidian vault

Settings → Workspace → **Import Vault Folder**. This is a one-time copy into Noa's local storage; it does not keep the files in sync. For ongoing use, connect the folder instead.

### Back up your notes

Settings → Data offers two kinds of backup.

| Kind | What it covers | Notes |
|---|---|---|
| **Manual export** | Notes, folders, attachments, workspace name | Formats: JSON snapshot (no app settings), Vault ZIP (Markdown + attachments), static HTML (for reading, not restoring) |
| **Automatic backup** | Same as JSON snapshot | Choose a folder; a snapshot is taken now and again on launch once 24 hours have passed. **Run backup now** forces one. |

Exports and automatic backups cover Noa's local notes and one-time imports. They do not cover notes that live in a connected folder, because those files are already on disk.

Backup health is based on your last export: **healthy** within 7 days, **warning** within 14 days, **risk** after that or if you have never exported.

## Keyboard shortcuts

On Windows and Linux, use `Ctrl` in place of `⌘`.

| Shortcut | Action |
|---|---|
| `⌘N` | New note |
| `⌘S` | Save now (edits also save automatically) |
| `⌘F` | Search notes |
| `⌘K`, `⌘P`, `⌘O` | Command palette |
| `⌘⇧K` | Open today's daily note |
| `⌘⇧F` | Focus mode |
| `⌘E` | Switch editor / preview |
| `⌘[`, `⌘]` | Back / forward (Alt+Left / Alt+Right outside macOS) |
| `⌘⇧S` | Capture window (desktop app only) |
| `Escape` | Clear search; exit focus mode |

## Privacy and data

- **Where notes live:** IndexedDB in your browser or desktop app, or your connected folder. Nothing else is stored off-device.
- **Network:** The desktop app checks GitHub Releases for updates. Settings → About → Feedback's **Send Feedback** opens a prefilled GitHub issue in your browser. The template includes your browser user agent, platform, language, and app version. Nothing is sent until you submit it.
- **Diagnostics:** The same section can download a diagnostics file for a bug report. It is a local download; Noa does not upload it, and you decide whether to attach it.
- **No telemetry, no accounts.** Noa does not collect usage data.
- **Browser storage can be cleared.** Clearing site data in a browser deletes Noa's local notes. Keep an exported backup.

## Known limitations

- **Single window.** Noa is designed for one window at a time; multi-tab use is not coordinated.
- **Large graphs slow down.** The graph view switches to a lighter physics mode above 200 nodes and is not virtualized, so 1,000+ nodes will be sluggish.
- **Connected-folder sync is polling-based**, as described above.
- **macOS builds are unsigned**, and only Apple Silicon is packaged.

## Development

```bash
npm run dev               # Vite dev server on :3000
npm run desktop:dev       # Electron app with live reload
npm run lint              # TypeScript type-check + ESLint
npm run test:unit         # Vitest
npm run test:smoke        # Playwright end-to-end (starts the dev server)
npm run build:budget      # Production build + bundle size check (entry ≤ 400 KB)
npm run check:structure   # dependency-cruiser layer-boundary check
npm run desktop:pack:mac  # Unsigned macOS dmg + zip (arm64)
```

Run `npm run check:structure` after changing `App.tsx` or adding imports to the app shell.

### Architecture at a glance

- **State:** `useNotes` is the single source of truth for notes, folders, and tasks. Components don't call storage directly.
- **Storage:** `lib/storage.ts` (IndexedDB via localForage) for local notes; `lib/fileSystemStorage.ts` for connected folders.
- **Vault sync:** `useFileSync` manages the folder connection; destructive folder operations go through a prepare/commit journal.
- **Imports:** Validated by `lib/dataIntegrity.ts` before anything touches storage.
- **Desktop shell:** `electron/` holds the main process, preload script, permission allowlist, and update installer.

### Layout

```
electron/      Main process, preload, permission and navigation guards, update installer
src/
  components/  Editor, sidebar, right panel, settings, dialogs
  hooks/       Core state and orchestration (notes, file sync, attachments, shortcuts)
  lib/         Storage, sync, import/export, backup health
  core/        Pure domain logic (search)
tests/         Playwright smoke tests
scripts/       Bundle budget, CSP checks, release evidence
docs/          Release process and operating notes
```

### Stack

React 19 · Vite · TypeScript · CodeMirror 6 · Tailwind CSS · localForage · Electron · Mermaid · KaTeX · react-force-graph-2d · Vitest · Playwright

## Contributing

Bug reports and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first for the setup, test expectations, and the pre-push gate. Release steps are in [docs/release.md](docs/release.md), and changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

Noa is free software released under the [GNU Affero General Public License v3.0](LICENSE) © rickkwang.
