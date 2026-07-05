# Design: Bidirectional Sync, Note Embeds, PDF Export

Date: 2026-07-06
Status: approved (user delegated final decisions)

## Scope

Three features, implemented in order of ascending risk:

1. PDF export via system print dialog
2. Note transclusion `![[Note]]` / `![[Note#Heading]]` in preview
3. Bidirectional file sync: all notes, runtime external-change detection, newest-wins

## 1. PDF export

- New `exportNoteAsPdf(note, attachmentDataUrls?)` in `src/lib/export.ts`.
- Reuses `mdToHtml`. Builds a complete HTML document with print CSS, sets
  `<title>` to the note title (becomes the default PDF filename), writes it to a
  hidden iframe via `srcdoc`, calls `contentWindow.print()` on load, removes the
  iframe after `afterprint` (with a timeout fallback).
- Attachment images are inlined as data URLs so they survive printing.
- UI entry point sits next to the existing Export MD / Export HTML actions.
- No new dependencies; identical behavior on web and Electron.

## 2. Note embeds (transclusion)

- `PreviewPane` embed resolution becomes three-tier:
  1. attachment match (existing behavior, unchanged),
  2. note title match via `titleToIds` → rewrite to `![](note-embed://id/<id>#anchor)`,
  3. missing placeholder.
- `img` component intercepts `note-embed://` and renders a `NoteEmbed` component:
  a bordered block with a clickable title bar (navigates to the source note) and a
  nested `<Markdown>` render of the target content.
- `#Heading` anchors slice the target from that heading to the next heading of the
  same or higher level. `#^block` refs fall back to whole-note embedding.
- Recursion: max depth 3 plus a visited-id set for cycle detection; over-limit
  renders a notice instead of content.
- No changes needed in `extractLinks` (already matches `![[x]]`) or
  `rewriteAttachmentEmbedsForVault` (only rewrites attachment matches, so note
  embeds round-trip to the vault untouched — Obsidian-compatible).

## 3. Bidirectional sync

### a) All-notes scope

- Remove the `isObsidianImportedNote` filters from the five sync callbacks in
  `useFileSync` and from `retryFullSync` call sites: every note writes to the vault.
- `note.source` keeps its frontmatter semantics only (obsidian-import notes don't
  re-extract tags from body).
- External-deletion rule changes from source-based to manifest-based: a note whose
  manifest entry's file is gone from disk was deleted externally → remove it from
  Noa. Notes never written to the manifest are unaffected.
- First `retryFullSync` after connect/bootstrap performs the one-time migration of
  native notes onto disk.

### b) Runtime external-change detection

- FSA has no watch API → polling. New `scanForChanges(handle, mtimeSnapshot)` in
  `fileSystemStorage.ts`: walks directories reading only `file.lastModified`,
  compares against an in-memory path→mtime snapshot, reads content only for
  changed/added files, reports deleted paths. Attachments are excluded from
  polling (full scan remains connect/bootstrap-only).
- Triggers: `window` focus + a 60 s interval while connected; paused when
  `document.hidden`.
- Self-write suppression: every successful `writeNote` updates that path's
  snapshot entry.
- Scans share the existing `withVaultLock` queue and respect the
  `getIsImporting()` import mutex.

### c) Newest-wins merge

- When a note exists on both sides: disk mtime > `note.updatedAt` → take the disk
  version; otherwise keep Noa's (the normal write path re-exports it).
- History snapshots remain the safety net for misjudged conflicts.

## Verification

- Unit tests (vitest, `tests/unit/`): newest-wins merge, incremental scan diff,
  heading slicing, cycle detection.
- `npm run lint`, `npm run test:unit`, `npm run check:structure`,
  `npm run build:budget` (no new deps — bundle should not grow materially).
