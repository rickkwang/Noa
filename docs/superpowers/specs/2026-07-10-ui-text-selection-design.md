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
- CodeMirror's `.cm-editor` root;
- content regions explicitly marked `.noa-selectable`, starting with Markdown preview.

Print-only preview content stays selectable through the same `.noa-selectable` marker. Native controls such as buttons, tabs, sliders, and selects remain part of the non-selectable shell.

## Regression Coverage

Add one browser test that verifies computed selection policy in the running app:

- application shell and settings headings are `none`;
- search input, CodeMirror, and Markdown preview are `text`.

Run TypeScript, architecture, unit, smoke, and build-budget checks after implementation.
