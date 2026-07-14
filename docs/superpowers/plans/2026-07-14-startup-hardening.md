# Noa Startup Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prevent duplicate Electron processes from competing for Noa's profile and move the heavy right-panel/graph lazy import out of the first render.

**Architecture:** Add a small CommonJS single-instance coordinator that is independently unit-testable, then gate Electron lifecycle registration on its result. In React, keep the right panel unmounted until one animation frame after it is first needed, preserving its mounted state after the first open so later toggles remain instant.

**Tech Stack:** Electron 41, React 19, TypeScript, Vitest, Playwright, Vite.

---

### Task 1: Electron single-instance coordination

**Files:**
- Create: `electron/singleInstance.cjs`
- Modify: `electron/main.cjs`
- Test: `tests/unit/singleInstance.test.ts`

- [x] **Step 1: Write failing coordinator tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { installSingleInstanceGuard } from '../../electron/singleInstance.cjs';

describe('installSingleInstanceGuard', () => {
  it('quits a secondary process before lifecycle bootstrap', () => {
    const quit = vi.fn();
    const app = { requestSingleInstanceLock: () => false, quit, on: vi.fn(), isReady: () => false };
    expect(installSingleInstanceGuard({ app, getWindow: () => null, createWindow: vi.fn() })).toBe(false);
    expect(quit).toHaveBeenCalledOnce();
  });

  it('restores and focuses the primary window for a second launch', () => {
    let secondInstance: (() => void) | undefined;
    const win = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() };
    const app = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: (_event: string, listener: () => void) => { secondInstance = listener; },
      isReady: () => true,
    };
    expect(installSingleInstanceGuard({ app, getWindow: () => win, createWindow: vi.fn() })).toBe(true);
    secondInstance?.();
    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
  });
});
```

- [x] **Step 2: Run the focused test and confirm failure**

Run: `npm run test:unit -- singleInstance`

Expected: FAIL because `electron/singleInstance.cjs` does not exist.

- [x] **Step 3: Implement the minimal coordinator**

```js
function installSingleInstanceGuard({ app, getWindow, createWindow }) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    const existing = getWindow();
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    if (app.isReady()) createWindow();
  });
  return true;
}

module.exports = { installSingleInstanceGuard };
```

- [x] **Step 4: Gate main-process bootstrap on the coordinator**

Import `installSingleInstanceGuard`, install it with `getWindow: () => win`, and wrap `app.whenReady()`, `window-all-closed`, and `before-quit` registration so only the primary process initializes Electron services.

- [x] **Step 5: Run focused unit tests**

Run: `npm run test:unit -- singleInstance`

Expected: PASS.

### Task 2: Defer right-panel and graph startup work

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/e2e.spec.ts`

- [x] **Step 1: Add a failing browser regression test**

```ts
test('closed right panel defers its lazy content until first open', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app-right-panel-open', 'false');
    localStorage.setItem('redaction-storage-notice-seen', '1');
  });
  await page.goto('/');
  await expect(page.locator('[data-noa-right-panel-content]')).toHaveCount(0);
  await page.getByTitle('Toggle Panel').click();
  await expect(page.locator('[data-noa-right-panel-content]')).toHaveCount(1);
  await page.getByTitle('Toggle Panel').click();
  await expect(page.locator('[data-noa-right-panel-content]')).toHaveCount(1);
});
```

- [x] **Step 2: Run the focused browser test and confirm failure**

Run: `npm run test:smoke -- --grep "closed right panel defers"`

Expected: FAIL because the right-panel content is always mounted and has no diagnostic marker.

- [x] **Step 3: Defer the first mount by one animation frame**

After `useLayout()`, initialize `hasMountedRightPanel` to `false`. When `isRightPanelOpen` first becomes true, schedule `setHasMountedRightPanel(true)` with `requestAnimationFrame`; cancel the pending frame on cleanup. Render the existing `ErrorBoundary`/`Suspense`/`RightPanel` subtree only when `hasMountedRightPanel` is true, and mark its wrapper with `data-noa-right-panel-content`.

- [x] **Step 4: Re-run right-panel and graph browser coverage**

Run: `npm run test:smoke -- --grep "closed right panel defers|graph tab opens|graph controls|graph canvas"`

Expected: all selected tests PASS.

### Task 3: Full validation and release-risk review

**Files:**
- Verify only; no additional source files.

- [x] **Step 1: Run static and architecture checks**

Run: `npm run lint`

Expected: PASS.

Run: `npm run check:structure`

Expected: PASS.

- [x] **Step 2: Run all unit tests**

Run: `npm run test:unit`

Expected: PASS.

- [x] **Step 3: Run all smoke tests**

Run: `npm run test:smoke`

Expected: PASS.

- [x] **Step 4: Verify production bundle budgets**

Run: `npm run build:budget`

Expected: PASS with the entry chunk below 400KB and lazy chunks below the configured hard limit.

- [x] **Step 5: Review the final workspace**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only the plan, coordinator, main-process integration, App change, and two regression-test files are modified. Do not commit unless the user explicitly requests a commit.
