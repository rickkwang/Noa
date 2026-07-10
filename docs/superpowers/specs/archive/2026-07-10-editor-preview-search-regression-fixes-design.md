# Editor, Preview, and Search Regression Fixes Design

## Context

The current performance-oriented worktree changes introduce three confirmed correctness regressions:

1. CodeMirror can ignore a legitimate same-note external transition from locally emitted content `A`, to external content `B`, and back to `A`.
2. Large Markdown previews can split inside valid CommonMark constructs and change their rendered meaning.
3. A debounced sidebar-index refresh can run with an old search query after a newer query has already rendered.

The fixes must preserve the intended performance improvements: avoid serializing the CodeMirror document during ordinary React round trips, keep large-note preview work chunked, and avoid rebuilding the search index while no search is active.

## Design

### CodeMirror content authority

`useCodeMirror` will replace `lastEmittedContentRef` with an `editorContentRef` that mirrors the content currently held by the active `EditorView`.

- Initialize the ref from the document used to create each `EditorView`.
- Update it on every `docChanged` transaction, including transactions annotated as remote sync.
- Continue suppressing `onUpdate` for remote transactions and in-progress IME composition.
- In the external-content effect, return early only when `note.content` equals `editorContentRef.current`.
- When content differs, compute the existing minimal replacement from the mirrored editor content and dispatch it with `remoteSyncAnnotation`.

This retains the fast React round-trip path without confusing historical local content with the editor's current state.

### Semantically safe Markdown chunk boundaries

`splitMarkdownForChunkedPreview` will use a lightweight, conservative block-state scanner that preserves the existing linear-time performance.

- Parse only documents at or above the existing size threshold.
- Track the active fence marker and opening run length so only a matching marker run of equal or greater length, with no trailing info string, closes the fence.
- Track display-math fences so heading-looking lines inside math never become cut points.
- Conservatively return the original Markdown as one chunk when a raw HTML block opener is present; accurately reproducing all cross-line CommonMark HTML states would make the splitter heavier and less reliable.
- Return the original Markdown as one chunk when a reference definition or footnote definition is present because those constructs have document-wide scope.
- Consider only column-zero ATX headings outside those constructs as possible cut boundaries.
- Preserve the existing minimum chunk size merging and lossless `chunks.join('') === markdown` invariant.

The preview remains chunked for ordinary large notes with scanner cost close to the original implementation. Documents containing raw HTML trade chunking for guaranteed semantic preservation.

To make chunk memoization effective, the note context captured by Markdown component renderers remains stable during active-note content-only edits. Title/folder changes and embedded-note content or attachment changes still invalidate that context, so link resolution and transclusions stay current without forcing every unchanged chunk to parse again on each keystroke.

### Latest-query sidebar refresh

`useSidebarSearch` will keep the latest deferred query in a ref alongside the existing latest-inputs ref.

- Update the query ref every render.
- The debounced index-refresh callback reads the query and case-sensitivity setting from the latest refs when it fires.
- If the latest query is empty, the callback does not repopulate results.
- The non-deferred query is the hard gate for scheduling and immediately cancels pending work when cleared.
- Query changes continue to run the immediate query effect; they do not cause an additional index rebuild or redundant delayed search.

This keeps the on-demand indexing behavior while removing stale closure writes.

## Testing

Targeted regression coverage will verify:

- CodeMirror's current-content tracking accepts the `A -> B -> A` same-note sequence.
- Four-backtick fences containing triple backticks are not split internally.
- HTML blocks containing heading-looking lines are not split internally.
- Math blocks, ordinary fences, reference definitions, lossless joins, and minimum chunk sizing retain their existing behavior.
- A pending refresh scheduled under an old query cannot replace results for a newer query.

After targeted tests pass, run the repository guardrails:

- `git diff --check`
- `npm run lint`
- `npm run check:structure`
- `npm run test:unit`
- `npm run build:budget`
- `npm run test:smoke`

## Scope

The change is limited to the three confirmed regressions and their tests. It will not redesign the editor, replace the search engine, remove deferred rendering, alter Markdown feature support, or refactor unrelated worktree changes.
