# Vault Mirror Mode — Design

Date: 2026-07-12
Status: Approved by user

## Problem

Connecting Noa to an Obsidian vault currently runs a bidirectional merge:

1. `connect()` (`useFileSync.ts`) scans the vault and imports every `.md` file
   into Noa's note pool (IndexedDB).
2. It then calls `retryFullSync(handle, merged, ...)`, which writes **every**
   merged note — including Noa's own local notes — into the vault directory,
   plus a `manifest.json`.

Result: the user's Noa notes are duplicated into their Obsidian vault, and the
vault's notes are duplicated into Noa. Every subsequent edit, retry, reconnect,
and external-change poll keeps both sides merged into one pool.

## Goal

Connect = **mirror**, not merge:

- Vault files are displayed and fully editable in Noa; every change writes back
  to the original file on disk. External changes (Obsidian, Finder) flow in.
- Noa's own notes are **never** written into the vault.
- Vault files are **never** imported into Noa's own note pool.
- Existing cross-copied data gets a guided cleanup.

## Decisions (confirmed with user)

1. **Presentation**: a separate, collapsible **Vault section** in the sidebar
   (labeled with the vault directory name + sync status), below Noa's own
   folder tree. It disappears on disconnect.
2. **Operations on vault notes**: full read-write — edit content, rename,
   create, delete, move (within the vault). All operations act directly on the
   disk files, equivalent to doing them in Obsidian.
3. **Legacy cleanup**: Noa provides a cleanup wizard (see §7).
4. **Storage architecture**: cached mirror (Option A) — vault notes are cached
   in IndexedDB with an origin marker; disk is always authoritative. Rejected:
   a fully separate store (too invasive — editor/search/graph/tasks assume one
   notes array) and a memory-only mirror (blank vault section on cold start /
   offline / permission-pending).

## Design

### 1. Data model

- `Note` and `Folder` gain an origin marker `origin?: 'vault'`, set by the
  vault scan. Marked rows are a **cache of disk state**; disk is
  authoritative. Unmarked rows are Noa-owned and unrelated to the vault.
- The vault's `manifest.json` is kept, with narrowed purpose: stable note ids
  across renames, and tracking external deletions. It must never again contain
  `source: 'noa'` entries (Noa notes are never written to disk).
- Legacy one-time imports (`source: 'obsidian-import'` notes from
  `importVaultFolder`/`importZip`) are untouched: they carry no origin marker
  and remain ordinary Noa notes. The existing `source` field is not reused as
  the mirror marker precisely because it conflates one-time imports.

### 2. Connect / sync flow (core change)

- **Seeding removed**: `retryFullSync(all notes)` is deleted from `connect`,
  bootstrap, `retry`, and `reconnect`. Connecting does one thing: scan vault →
  mark rows `origin: 'vault'` → write to the IndexedDB cache. Noa notes take
  no part in the merge and are never written to disk.
- `mergeVaultNotes` simplifies to operate **only on vault-origin rows**: disk
  content overwrites the cache; files deleted externally drop their cache row
  (manifest-tracked ids only, as today); Noa-owned rows pass through
  untouched.
- External-change detection (window focus + 60 s poll) is unchanged
  mechanically, but likewise only affects vault-origin rows.
- Upgrade path: on the first scan after upgrade, existing IndexedDB rows whose
  ids match scanned vault ids are re-marked `origin: 'vault'` in place — the
  previously imported vault copies become the mirror cache with no data
  movement. Non-matching `obsidian-import` rows stay as regular Noa notes.

### 3. Write paths (full read-write)

- Edits / rename / create / delete / move-within-vault on vault notes write
  through to the original disk files via the existing `syncNoteOn*` /
  `syncFolderOn*` machinery, with an origin guard at the entry points:
  **calls for non-vault notes are no-ops**.
- Defense in depth: `writeNote` (service layer) rejects notes without the
  vault origin marker.
- Creating a note/folder inside the Vault section creates the corresponding
  file/directory on disk and marks the row `origin: 'vault'`.
- **Cross-section drag (Noa ↔ Vault) is disallowed in v1** with a toast. This
  is the only operation that could copy/move a file across the boundary; it
  stays closed to prevent accidental duplication. A future explicit
  "export to vault" action can reopen it deliberately.
- Daily notes and templates are always created on the Noa side.
- While permission is pending / cache not hydrated, vault rows are read-only
  (existing `vaultCacheReadOnly` mechanism).

### 4. UI

- Sidebar: new independent Vault section under Noa's folder tree — header
  shows vault directory name + sync status, body is the vault folder tree,
  collapsible. Disconnect removes the whole section.
- Search, graph, backlinks, tasks, and the command palette cover both pools
  (vault notes are "displayed in Noa"). Wikilinks resolve across pools
  read-only; resolution never triggers any file copy.

### 5. Export / backup

- `exportJson`, `exportZip`, HTML export, and auto-backup all **exclude
  vault-origin rows** (notes and folders). Vault content is owned by the disk;
  it does not enter Noa backups.

### 6. Disconnect

- Confirmation dialog → delete all vault-origin note/folder cache rows from
  IndexedDB, clear the persisted handle and stat snapshot. Disk files are
  untouched.

### 7. Cleanup wizard (legacy repair)

Trigger: during connect (or first bootstrap after upgrade), the scan finds
`manifest.json` entries with `source: 'noa'` — files the old mode copied from
Noa into the vault.

- For each such file, compare its content with the local Noa note of the same
  id:
  - Local note exists and content is identical → listed as **safe to delete**.
  - Content differs (edited in Obsidian since seeding) or the local note no
    longer exists → **kept**, listed as "needs manual review"; the file stays
    visible in the Vault section.
- The wizard shows both lists; on confirm it deletes the safe files from the
  vault and removes their manifest entries.
- Noa side needs no deletion: existing vault-copy rows are adopted as the
  mirror cache via the id match in §2.

### 8. Testing

- Unit (vitest): new merge semantics (Noa rows never touched, never emitted
  for disk writes); write-path guards (`writeNote` rejects Noa-origin notes;
  `syncNoteOn*` no-ops for Noa notes); export filtering excludes vault rows;
  cleanup-wizard three-way classification (identical / differs / local
  missing).
- Update existing `fileSyncService` / `useFileSync` unit tests for the new
  semantics.
- Playwright smoke suite must stay green.

## Affected files

`src/types.ts`, `src/services/fileSyncService.ts`,
`src/lib/fileSystemStorage.ts`, `src/hooks/useFileSync.ts`,
`src/hooks/useNotes.ts` (cache purge on disconnect),
`src/hooks/useDataTransfer.ts` (export filters), sidebar component(s),
`App.tsx` wiring, new cleanup-wizard modal component.

## Out of scope (v1)

- Cross-section drag / explicit "export note to vault" action.
- Bidirectional attachment management beyond current behavior.
- Multi-vault support.
