# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Design spec for the semantic theme token refactor (`docs/superpowers/specs/`).

### Changed
- Migrated all icons from Lucide to Phosphor via a central mapping (`src/lib/icons.tsx`).
- Unified the accent color to coral (#CC7D5E) across themes; refined graph toolbar, top bar alignment, and search box styling.
- Enabled TypeScript `strict` mode; fixed the type gaps it surfaced.
- Removed unused dependencies (`lucide-react`, `rehype-raw`, `autoprefixer`, `tsx`), declared previously-transitive ones (`unist-util-visit`, `@types/react-dom`, `@types/mdast`), and dropped the stale `bun.lockb`/`metadata.json`.

### Fixed
- Preview rendering: footnotes, callouts, visible list markers in light mode; enabled soft line breaks.
- Re-affirm File System Access grants on Electron launch.
- Vault notes imported at the root level now get an explicit empty folder id instead of `undefined`.

### Removed
- Recurring backup reminder banner.

## [1.0.16] - 2026-06-08

### Added
- Automatic daily backup to a local folder.
- Redesigned graph view with consolidated entry points, stabilized layout, and persisted tab state.
- Wikilink autocomplete with recency ranking, fuzzy matching, and match highlighting.
- Redesigned TasksPanel rows and filters; completed section collapses; task markers hidden in the editor.

### Changed
- Editor theme and tab-bar UX refinements; Obsidian markdown parity improvements; right-panel cleanup.
- Sidebar visual clarity and drag-and-drop affordances; calendar stays mounted during search.

### Fixed
- Hardened data integrity across import, rename, and sync paths.
- Hardened vault import attachment matching.
- Tag clicks now use tag-filter and highlight the active tag in TagBrowser.
- Editor's first line no longer clips behind the toolbar.

## [1.0.15] - 2026-04-19

### Added
- OutgoingLinksPanel with improved dark mode across the right panel.
- Graph reset-view animation and fixed tab width.

### Fixed
- Restored the app icon in the desktop build and ensured the installer uses a distinct volume title.
- Hardened edit/navigate races; sanitized Mermaid SVG output; persisted graph layout.
- Resolved stale-closure and race bugs in note move, navigation, and tab-limit warning.
- Stabilized graph drag interaction.

## [1.0.14] - 2026-04-10

Re-release of 1.0.13 to complete desktop asset publishing; no code changes.

## [1.0.13] - 2026-04-10

### Added
- Dark mode with a warm Anthropic-inspired palette.
- Note history panel with snapshots, and Mermaid diagram rendering.
- Callout rendering, slash commands, templates, focus mode, note sorting, nested tags, and a Properties panel.
- Obsidian alignment: wiki aliases, search operators, folder structure preserved from vault sync.
- Graph view enhancements: force-simulation tuning, filter and zoom controls, stats cards.

### Fixed
- Flash-of-wrong-theme on load; extensive dark-mode coverage fixes across preview, editor, and graph.
- Storage, sync, and search issues; import resilience; localStorage safety.
- Editor sync hardening and path utility deduplication.

## [1.0.12] - 2026-03-31

### Fixed
- Surface mac update install failures to the user instead of failing silently.

## [1.0.11] - 2026-03-31

### Fixed
- Hardened the mac app update install flow.

## [1.0.10] - 2026-03-31

### Fixed
- Added a mac app update installer fallback.

## [1.0.9] - 2026-03-31

### Fixed
- Added a mac update fallback for unsigned builds.

## [1.0.8] - 2026-03-31

### Added
- Improved sidebar selection and transfer states.

### Fixed
- Create the GitHub release before uploading desktop assets in CI.

## [1.0.7] - 2026-03-30

### Fixed
- Smoke test selector for Graph tab now uses exact role-name matching to avoid strict-mode ambiguity in CI.

## [1.0.6] - 2026-03-30

### Added
- CI dependency audit gate for high-severity issues.
- Playwright E2E coverage for note creation, search, and import/export.
- In-app diagnostics export and feedback entry points.

### Changed
- Tightened release and backup guidance in the UI copy.

### Fixed
- File sync architecture boundary and backup/import error mapping.
