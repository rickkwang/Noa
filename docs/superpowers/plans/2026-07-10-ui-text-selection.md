# UI Text Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent accidental selection of Noa application chrome while preserving selection and editing in note content and form controls.

**Architecture:** A stable class on the application root owns the non-selectable default. Global CSS restores text selection only for semantic editing controls, CodeMirror, and explicitly marked reading surfaces such as Markdown preview.

**Tech Stack:** React 19, Tailwind CSS 4, CodeMirror 6, Playwright

---

### Task 1: Define and verify the selection boundary

**Files:**
- Modify: `tests/e2e.spec.ts`
- Modify: `src/App.tsx:698`
- Modify: `src/index.css:21`
- Modify: `src/components/editor/PreviewPane.tsx:937`

- [x] **Step 1: Write the failing browser regression test**

Add this test to `tests/e2e.spec.ts`:

```ts
test('app chrome prevents accidental text selection while content remains selectable', async ({ page }) => {
  await page.goto('/');

  const userSelect = async (locator: import('@playwright/test').Locator) =>
    locator.evaluate((element) => getComputedStyle(element).userSelect);

  await expect(page.locator('.noa-app-shell')).toBeVisible();
  expect(await userSelect(page.locator('.noa-app-shell'))).toBe('none');
  expect(await userSelect(page.getByTitle('Double-click to rename'))).toBe('none');
  expect(await userSelect(page.getByPlaceholder('Search notes, tags...'))).toBe('text');
  expect(await userSelect(page.locator('.cm-content').last())).toBe('text');
  expect(await userSelect(page.locator('.noa-selectable').first())).toBe('text');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Editor' }).click();
  expect(await userSelect(page.getByPlaceholder('# {{date}}\n\n## Notes\n\n'))).toBe('text');
  await page.getByRole('tab', { name: 'Appearance' }).click();
  expect(await userSelect(page.getByRole('heading', { name: 'Theme' }))).toBe('none');
});
```

- [x] **Step 2: Run the new test and verify it fails**

Run:

```bash
npm run test:smoke -- --grep "app chrome prevents accidental text selection"
```

Expected: FAIL because `.noa-app-shell` and `.noa-selectable` do not exist yet.

- [x] **Step 3: Mark the application shell and Markdown preview boundary**

Change the loaded application root in `src/App.tsx` to include the stable shell class:

```tsx
<div className="noa-app-shell h-screen w-screen flex flex-col bg-[#EAE8E0] text-[#2D2D2D] font-redaction overflow-hidden selection:bg-[#CC7D5E] selection:text-white">
```

Change the `PreviewPane` root in `src/components/editor/PreviewPane.tsx` so both interactive and print previews remain selectable:

```tsx
className={printMode ? 'noa-selectable block' : 'noa-selectable flex-1 pt-8 pb-8 pl-8 overflow-y-auto flex flex-col bg-[#EAE8E0]/50'}
```

- [x] **Step 4: Add the centralized CSS selection policy**

Add this policy after the `body` rule in `src/index.css`:

```css
.noa-app-shell {
  -webkit-user-select: none;
  user-select: none;
}

.noa-selectable,
.noa-app-shell :where(input, textarea, [contenteditable]:not([contenteditable="false"]), .cm-editor) {
  -webkit-user-select: text;
  user-select: text;
}
```

- [x] **Step 5: Run the targeted test and verify it passes**

Run:

```bash
npm run test:smoke -- --grep "app chrome prevents accidental text selection"
```

Expected: 1 passed.

- [x] **Step 6: Run the complete repository validation suite**

Run:

```bash
npm run lint
npm run check:structure
npm run test:unit
npm run test:smoke
npm run build:budget
git diff --check
```

Expected: every command exits successfully; 21 unit-test files and all browser tests pass; the production entry and lazy chunks remain within configured budgets.

- [x] **Step 7: Commit the implementation**

```bash
git add src/App.tsx src/index.css src/components/editor/PreviewPane.tsx tests/e2e.spec.ts docs/superpowers/plans/2026-07-10-ui-text-selection.md
git commit -m "fix: prevent accidental UI text selection"
```
