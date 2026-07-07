# Obsidian-Aligned Wikilink Resolution

Date: 2026-07-07
Status: approved

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

Out of scope (explicitly deferred): Markdown-style internal links
(`[text](Note.md)`), frontmatter aliases, ghost-node click-to-create.

## Design

### Shared resolver (src/lib/noteUtils.ts)

```ts
normalizeLinkKey(raw: string): string
// trim → strip one trailing ".md" (case-insensitive) → toLowerCase()

buildLinkIndex(
  notes: Array<Pick<Note, 'id' | 'title' | 'folder'>>,
  folders?: Array<Pick<Folder, 'id' | 'name'>>,
): LinkIndex
// byTitle: Map<normKey, Array<{id, folderId}>>  — keyed on BOTH the exact-title
//   normKey and (when different) the .md-stripped key, so a note literally
//   titled "Note.md" still wins an exact match over suffix stripping.
// folderNameToIds: Map<normalizedFolderName, Set<folderId>>

resolveLinkTarget(
  rawTarget: string,          // extractLinks output: alias/anchor stripped, may contain "/"
  sourceFolderId: string,     // note.folder of the linking note
  index: LinkIndex,
): string | null              // single note id, or null (unresolved)
```

Resolution algorithm:

1. Split `rawTarget` on `/`. Basename = last segment; parent hint = second-to-last
   segment (if any). Look up candidates by `normalizeLinkKey(basename)`.
2. Disambiguate multiple candidates, first rule that leaves ≥1 candidate wins:
   a. parent hint present → candidates whose folderId is in
      `folderNameToIds.get(normalize(parentHint))`
   b. candidates in the same folder as the source note
   c. candidates in the root (folder === '')
   d. stable order: sort by (folder name, id), take first
3. No candidates → null.

`extractLinks` is unchanged: `note.links` keeps storing the raw target (alias
and anchor stripped, path and case preserved). Normalization happens only at
resolve time, so stored data and on-disk frontmatter are untouched.

### Call-site changes

| Site | Before | After |
|---|---|---|
| `computeLinkRefs` | exact title match, all duplicates | `resolveLinkTarget`; ≤1 id per link. Signature gains optional `folders`. `recomputeLinkRefsForNotes/Subset` gain the same optional param; `useNotes`/`useDailyNotes` pass `foldersRef.current`. |
| `buildGraphModel` | edges = stored `linkRefs` ∪ title matches | edges resolved fresh from `links` via the resolver (stored `linkRefs` no longer read — kills stale-edge divergence #6 and is required for pick-one semantics). `GraphModelNote` gains `folder`; options gain `folders` and `showUnresolved`. |
| `getBacklinks` | linkRefs + exact-title fallback | linkRefs primary unchanged; fallback compares `normalizeLinkKey(link) === normalizeLinkKey(title)`. |
| `PreviewPane` (embeds + click-nav) | `titleToIds.get()` exact | `resolveLinkTarget` with the current note's folder; unresolved keeps the existing `note-internal://title/` fallback. Needs `folders` prop threaded App → Editor → PreviewPane. |

`useOutgoingLinks` also swaps `buildTitleToIdsMap` lookups for the resolver so
the outgoing-links panel agrees with the graph.

### Ghost nodes (graphModel + GraphView)

- Unresolved targets dedupe by `normalizeLinkKey`; node id `ghost:<normKey>`,
  title = raw basename, flag `ghost: true`.
- Participate in force layout and degree counts (Obsidian behavior); excluded
  from `stats.ranked`.
- Rendered faded (~35% opacity), no click action.
- New `showUnresolved` option, default ON, toggle in GraphView next to the
  existing filters. Existing filters (hideIsolated, localDepth, search, tags)
  apply to ghost nodes too.

### Edge cases

- A note literally titled `Note.md`: exact normKey match wins before suffix
  stripping (dual-key index above).
- CJK titles: `toLowerCase()` is a no-op — safe.
- `[[a/b/c/Note]]`: only basename + immediate parent hint are used (Noa folders
  are flat; deeper segments carry no information).
- Self-links unchanged (graphModel already handles self-edges).
- Behavior change to note: edges that existed only via stale stored `linkRefs`
  disappear from the graph. Intended.

### Testing

TDD, vitest (`tests/unit/noteUtils.test.ts`, `tests/unit/graphModel.test.ts`):

- `normalizeLinkKey` / `resolveLinkTarget`: path, case, `.md`, disambiguation
  priority matrix (parent hint > same folder > root > stable order), literal
  `Note.md` title, CJK.
- `computeLinkRefs`: duplicate titles now resolve to exactly one id.
- `buildGraphModel`: ghost node creation + dedupe + showUnresolved toggle;
  stale `linkRefs` no longer produce edges; degree/ranked semantics.
- `getBacklinks`: case-insensitive fallback.

Verification: `npm run test:unit`, `npm run lint`, `npm run check:structure`.
