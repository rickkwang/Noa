# Obsidian-Aligned Wikilink Resolution

Date: 2026-07-07 (revised 2026-07-08)
Status: approved

Revision 2026-07-08 — two rules corrected against verified Obsidian behavior:

1. Resolution is **source-independent**. Obsidian deliberately does not let the
   linking note's location influence where `[[A]]` points (moderator: "We don't
   want `[[A]]` to point to one note if it is contained in `Folder1/Note1.md`
   and to another note if it contained in `Folder2/Note2.md`"). A root-level
   note beats a same-folder sibling. The original "same folder as source" rule
   is removed; `resolveLinkTarget` no longer takes `sourceFolderId`.
2. Path links are **strict**. Obsidian treats `[[folder/Note]]` as an exact
   path; a path whose folder part matches nothing is unresolved (ghost node),
   not resolved by basename fallback. Since Noa folder names carry the full
   path (`Parent/Child`), the link's dirname is matched exactly against
   normalized folder names.

Post-implementation alignment sweep (same day):

- Folder-timing: initial load / `handleImportData` / vault-disconnect compute
  linkRefs before `setFolders` commits — `syncLinkRefs` gained a
  `foldersOverride` param and those paths pass the incoming folder list.
- Note creation now triggers a FULL linkRefs recompute (a new note can capture
  links that previously went unresolved or resolved to another duplicate).
- `getBacklinks` is linkRefs-only: every path into state recomputes refs, so
  the raw-title fallback only produced backlinks Obsidian doesn't show.
- `extractLinks`/PreviewPane tolerate table-escaped alias pipes
  (`[[Note\|display]]`).
- Ghost nodes are suppressed for attachment-extension targets
  (`![[image.png]]` embeds) — mirrors Obsidian's attachments-off default.
- GraphInfoPanel drops ghost ids from Active Connections so count matches the
  rendered rows; OutgoingLinksPanel snippet matching is case-insensitive and
  path/`.md`/anchor tolerant.

## Problem

Noa resolves `[[wikilinks]]` by exact, case-sensitive note-title match. Obsidian
resolves by file path, case-insensitively, with `.md`-suffix tolerance, picks a
single target when names are ambiguous, and shows unresolved targets as ghost
nodes in the graph. Users syncing an Obsidian vault see different graph edges in
Noa than in Obsidian.

Divergences fixed by this design:

1. `[[folder/Note]]` path links never resolve (Noa matches the whole string as a title).
2. Case-sensitive matching (`[[my note]]` fails against `My Note`).
3. `[[Note.md]]` suffix never resolves.
4. Duplicate titles: Noa links to ALL matches; Obsidian picks one.
5. Unresolved links are dropped; Obsidian shows faded ghost nodes.
6. Graph edges are the union of stored `linkRefs` and title matches, so stale
   frontmatter `linkRefs` can produce edges Obsidian doesn't have.

Out of scope (explicitly deferred): frontmatter aliases, ghost-node
click-to-create, leading-`/` (root-forced) prefixes, markdown links without a
`.md` extension, and title-vs-filename divergence when `sanitizeFilename`
rewrites titles containing invalid path characters on vault export.

Added 2026-07-08 (real-vault gap — excerpt notes were connected in Obsidian
via `[text](./Excerpts/Note.md)` markdown links, invisible to Noa):

- `extractLinks` also parses markdown-style internal links: `[text](path.md)`
  with tolerant percent-decoding (runs of valid `%XX` decode together; a
  malformed escape like a literal `%泄` is left as-is), `<>`-wrapped targets,
  optional `"title"` suffix, `#anchor` stripped. External schemes, `#`-only
  anchors, and non-`.md` targets are ignored.
- `resolveLinkTarget` gains an optional `sourceFolderId`: path links try the
  vault-absolute dirname first, then the dirname relative to the linking
  note's folder (Obsidian gives absolute precedence); a leading `./` or `../`
  forces relative-only. Bare-name resolution stays source-independent.
- PreviewPane resolves internal markdown links on click (in-app navigation;
  unresolved renders inert). Stored `links` keep the raw decoded target.
- Notes already imported from a vault carry pre-computed `links` — markdown
  links appear after the next disk scan re-extracts them.

## Design

### Shared resolver (src/lib/noteUtils.ts)

```ts
normalizeLinkKey(raw: string): string
// trim → toLowerCase() → strip one trailing ".md"

buildLinkIndex(
  notes: Array<Pick<Note, 'id' | 'title' | 'folder'>>,
  folders?: Array<Pick<Folder, 'id' | 'name'>>,
): LinkIndex
// byTitle: Map<lowercased title, Array<{id, folderId}>>
// folderKeyToIds: Map<lowercased folder name (full path), Set<folderId>>
// folderIdToKey: Map<folderId, lowercased folder name> (stable-sort support)

resolveLinkTarget(
  rawTarget: string,          // extractLinks output: alias/anchor stripped, may contain "/"
  index: LinkIndex,
): string | null              // single note id, or null (unresolved)
```

Resolution algorithm (source-independent, matching Obsidian):

1. Split `rawTarget` on `/`. Basename = last segment; dirname = the joined
   preceding segments. Candidates: exact case-insensitive title lookup on the
   basename first, then (only if empty) the `.md`-stripped key — so a note
   literally titled `Note.md` beats `Note` for `[[Note.md]]`.
2. Dirname present → strict path link: keep only candidates whose folder's
   normalized name equals the dirname; none left → unresolved (no basename
   fallback).
3. Still ambiguous → candidates in the root (`folder === ''`) win (verified
   Obsidian behavior: `[[A]]` resolves to `/A.md` over `Folder/A.md` no matter
   where the linking note lives). Remaining ties break by stable
   (folder name, id) order — Obsidian's own tie-break beyond root precedence is
   undocumented ("first one it finds"), so any deterministic order is faithful.
4. No candidates → null.

`extractLinks` is unchanged: `note.links` keeps storing the raw target (alias
and anchor stripped, path and case preserved). Normalization happens only at
resolve time, so stored data and on-disk frontmatter are untouched.

### Call-site changes

| Site | Before | After |
|---|---|---|
| `computeLinkRefs` | exact title match, all duplicates | `resolveLinkTarget`; ≤1 id per link. Signature gains optional `folders`. `recomputeLinkRefsForNotes/Subset` gain the same optional param; `useNotes`/`useDailyNotes` pass `foldersRef.current`. |
| `buildGraphModel` | edges = stored `linkRefs` ∪ title matches | edges resolved fresh from `links` via the resolver (stored `linkRefs` no longer read — kills stale-edge divergence #6 and is required for pick-one semantics). `GraphModelNote` gains `folder`; options gain `folders` and `showUnresolved`. |
| `getBacklinks` | linkRefs + exact-title fallback | linkRefs primary unchanged; fallback compares `normalizeLinkKey(link) === normalizeLinkKey(title)`. |
| `PreviewPane` (embeds + click-nav) | `titleToIds.get()` exact | `resolveLinkTarget` (no source-folder input needed); unresolved keeps the existing `note-internal://title/` fallback. Needs `folders` prop threaded App → Editor → PreviewPane. |
| `handleMoveNote` (`useNotes`) | subset linkRefs recompute | full recompute — moving a note between folders changes which `[[folder/Note]]` path links resolve vault-wide. Folder renames likewise trigger a full recompute. |

`useOutgoingLinks` also swaps `buildTitleToIdsMap` lookups for the resolver so
the outgoing-links panel agrees with the graph.

### Ghost nodes (graphModel + GraphView)

- Unresolved targets dedupe by `normalizeLinkKey` of the whole raw target (so
  `[[foo]]` and `[[Foo.md]]` collapse, but `[[a/Note]]` and `[[b/Note]]` stay
  distinct); node id `ghost:<normKey>`, title = raw target as typed, flag
  `ghost: true`.
- Participate in force layout and degree counts (Obsidian behavior); excluded
  from `stats.ranked`.
- Rendered faded (~35% opacity), no click action.
- New `showUnresolved` option, default ON, toggle in GraphView next to the
  existing filters. Existing filters (hideIsolated, localDepth, search, tags)
  apply to ghost nodes too.

### Edge cases

- A note literally titled `Note.md`: exact lookup runs before suffix stripping.
- CJK titles: `toLowerCase()` is a no-op — safe.
- `[[a/b/Note]]`: Noa folder names carry the full path (`a/b`), so the link's
  entire dirname is matched against folder names — deeper segments are used,
  not discarded.
- Self-links unchanged (graphModel already handles self-edges).
- Behavior change to note: edges that existed only via stale stored `linkRefs`
  disappear from the graph. Intended.

### Testing

TDD, vitest (`tests/unit/noteUtils.test.ts`, `tests/unit/graphModel.test.ts`):

- `normalizeLinkKey` / `resolveLinkTarget`: path, case, `.md`, disambiguation
  priority matrix (exact path > root > stable order; strict path links go
  unresolved on a bad dirname; source folder never matters), literal
  `Note.md` title, CJK.
- `computeLinkRefs`: duplicate titles now resolve to exactly one id.
- `buildGraphModel`: ghost node creation + dedupe + showUnresolved toggle;
  stale `linkRefs` no longer produce edges; degree/ranked semantics.
- `getBacklinks`: case-insensitive fallback.

Verification: `npm run test:unit`, `npm run lint`, `npm run check:structure`.
