# UI Text Selection Design

## Goal

Make Noa's desktop-style interface resist accidental text selection while preserving normal selection, editing, and copy behavior in note content and form controls.

## Confirmed Current Behavior

- Sidebar file rows already compute to `user-select: none` because they opt into `select-none` locally.
- Tab titles, settings headings, and other application chrome compute to `user-select: auto` and can be selected accidentally.
- Markdown preview content computes to `user-select: auto` and should remain selectable.
- CodeMirror and form controls must remain editable and selectable.

## Considered Approaches

1. Add `select-none` to each UI component. This minimizes each individual edit but repeats policy throughout the component tree and will miss newly added chrome.
2. Set a non-selectable application-shell policy and explicitly allow selection in content and form regions. This centralizes the default, keeps exceptions visible, and scales to new UI components.
3. Cancel browser `selectstart` events outside content regions. This is more complex and risks interfering with CodeMirror, input methods, and accessibility behavior.

Approach 2 is selected.

## Design

The root application container receives a stable `noa-app-shell` class. Global CSS makes that shell non-selectable. A narrow allowlist restores text selection for:

- `input` and `textarea` elements;
- editable DOM nodes marked with `contenteditable`;
- CodeMirror's `.cm-content` in both editable and read-only vault states;
- content regions explicitly marked `.noa-selectable`, including Markdown preview, version-history content, and error diagnostics.

Print-only preview content stays selectable through the same `.noa-selectable` marker. Clickable UI lists such as search results, tasks, backlinks, and outgoing links remain non-selectable to avoid accidental highlighting during navigation.

## Regression Coverage

Browser tests verify that:

- application shell, tabs, and settings headings are non-selectable;
- search input, editable and read-only CodeMirror content, textareas, Markdown preview, and version-history content remain selectable;
- the compact graph filter retains a visible focus indicator for keyboard navigation.

The complete TypeScript, architecture, unit, browser, and build-budget checks validate the implementation after changes.
