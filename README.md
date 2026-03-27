# Noa

> *Notes on Anything — 随手记录一切*

A pixel-aesthetic, local-first personal knowledge base. Write notes, keep a diary, manage tasks, and map your ideas — all in your browser, all yours.

---

## What is Noa?

Noa is a fully client-side Markdown note-taking app inspired by tools like Obsidian, wrapped in a retro pixel aesthetic. No accounts. No servers. No sync fees. Everything lives in your browser's IndexedDB.

**Core principles:**

- **Local-first** — your data never leaves your device
- **Notes on Anything** — daily journal, knowledge base, task list, or all three at once
- **Pixel & retro aesthetic** — opinionated design with Redaction 50 font, pixel grid, and a warm paper palette
- **Markdown native** — edit, preview, or split view; full GFM support

---

## Features

| Feature | Description |
|---------|-------------|
| Markdown editor | CodeMirror 6, edit / preview / split view |
| Wiki links | `[[Note Title]]` bidirectional linking |
| Knowledge graph | Force-directed graph of note connections |
| Daily notes | One-key journal entry (`⌘ K`) |
| Tasks panel | Global checkbox tracker across all notes |
| Backlinks | See every note that references the current one |
| Tag explorer | Browse and filter notes by tags |
| File System Sync | Sync to a local folder via File System Access API |
| Import / Export | JSON backup, ZIP archive, HTML export |
| Focus mode | Fade inactive paragraphs while writing |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘ N` | New note |
| `⌘ F` | Search notes |
| `⌘ K` | Open today's daily note |
| `⌘ S` | Save (auto-saved) |
| `Escape` | Close search / dismiss |

---

## Run Locally

**Prerequisites:** Node.js

```bash
npm install    # Install dependencies
npm run dev    # Start dev server at http://localhost:3000
```

## Quality Gates

```bash
npm run lint           # Type check
npm run build:budget   # Production build + bundle budget check
npm run test:smoke     # Playwright smoke tests (requires browser install)
```

---

## Tech Stack

- **React 19** + **TypeScript**
- **Vite** + **Tailwind CSS v4**
- **CodeMirror 6** — editor engine
- **localforage** — IndexedDB persistence
- **react-force-graph-2d** + **d3-force** — knowledge graph
- **Playwright** — smoke tests

---

## Release Docs

- [Release Policy](./docs/release-policy.md)
- [Release Checklist](./docs/release-checklist.md)
- [Operating Rhythm](./docs/operating-rhythm.md)
