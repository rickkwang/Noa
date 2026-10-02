# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- The graph alone can no longer be dragged narrower than the width it opens at.
- The Connections drawer opens without a fade, and its toggle sits at the drawer's top edge while open.
- Zoomed far out, the graph hides hub and active-note labels too; hovering a node still shows its name.

### Fixed
- Dragging the graph to its widest keeps the editor at least 380px wide, so the scrollbar gutter no longer cuts into the text.

## [1.0.26] - 2026-10-02

### Added
- The right column is a stack of up to two floating cards, opened from one panel menu in the titlebar; drag the gap between two cards to split their height.
- Expand any card over the editor; the graph alone opens wide and can be dragged up to 70% of the window.

### Changed
- Editor tabs are pills on a taller titlebar, with the traffic lights and titlebar controls on one centre line.
- The graph scales with its card frame by frame, keeps nodes small when zoomed, and its filters are a quiet search field and segmented controls; the on-canvas zoom buttons are gone.
- Every popup menu shares one shape: export, templates, workspace, font picker, outline, slash commands and link suggestions.
- The right column, its cards and the Calendar/Tags drawers open and close without animation.
- Dragging the right column's width no longer restyles the whole document on every frame.
- Calendar, Tags and Settings share one footer row with the workspace switcher; the sidebar tree is quieter and the calendar grid fills its panel.
- Right-panel section headers line up across cards, and tasks render `[[links]]` and `#tags` instead of raw Markdown.
- The graph stays stable and readable while filtering.
- Floating surfaces drop the hard black border.

### Fixed
- Pressing a resize handle without moving no longer snaps the panel back to an earlier width.
- The graph canvas is not reallocated when the reported screen width shrinks.
- Vault images resolve by path, and attachments no longer lose data.
- Bold text is visible, the line-height setting is honoured, and the web titlebar fits.
- Keyboard focus lands where writing starts, and the phone layout is repaired.
- The daily-notes toggle controls the sidebar toolbar button.

## [1.0.25] - 2026-09-18

### Added
- Rework sidebar drag-and-drop on a wash-and-chip interaction model.

### Fixed
- Stop the translucent sidebar flashing when the app regains focus.

### Changed
- Unify the sidebar collapse, right panel, and Calendar/Tags drawer animations on one 320ms clock.
- Keep the sidebar resize drag off the root custom property for smoother resizing.
- Match the translucent sidebar to the platform menu material and settle icon and label tones.
- Put every scroll-edge fade on one eased, distance-driven curve.

## [1.0.24] - 2026-09-14

### Added
- Calendar activity filters and task indicators.
- First-launch guidance for connecting a Markdown folder.

### Fixed
- Wait for pending note edits, moves, and history restores before closing the desktop window; keep the window open when saving fails.
- Preserve edits and attachments when imports or storage writes fail.
- Detect empty-folder and attachment changes during vault polling, and refresh replaced attachment previews.
- Improve panel alignment, dark-mode visibility, dialog keyboard navigation, and overlapping notifications.
- Exclude Markdown code examples from task detection.

### Changed
- Lighten the light-theme canvas and sidebar backgrounds.
- Clarify where local notes are stored and when automatic backups run.
- Update dependencies with published security fixes.

## [1.0.23] - 2026-08-25

### Added
- AGPL-3.0 license.
- Design spec for the semantic theme token refactor (`docs/superpowers/specs/`).

### Changed
- Rewrote the README: corrected the file-sync description, documented attachments, Obsidian import, dark mode, auto backup, and the full development command list.
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

## [1.0.22] - 2026-08-04

### Added
- Hover the collapsed desktop sidebar control to preview the sidebar in its expanded position without moving the editor.

### Changed
- Kept Tasks directly before Properties in the right panel and made Graph consistently available.

### Fixed
- Kept sidebar surfaces, boundaries, and motion continuous through preview promotion, resize, interrupted transitions, and reduced-motion changes.

## [1.0.21] - 2026-08-03

### Added
- Keyboard navigation for graph nodes and broader desktop smoke coverage.

### Changed
- Refined the desktop title bar, panel layout, sidebar surfaces, graph controls, and responsive sizing.
- Improved graph lifecycle handling, filtering, and plugin-disable behavior.

### Fixed
- Prevented vault sync data loss and hardened storage bootstrap and recovery paths.
- Restored native title-bar control hit areas and cleaned up failed macOS update installs.

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
