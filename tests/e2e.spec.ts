import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

async function waitForMarkerPersisted(page: import('@playwright/test').Page, marker: string) {
  await page.waitForFunction(
    async (target) => {
      const request = indexedDB.open('redaction-diary-notes-db');
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) return false;

      const tx = db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const entries = await new Promise<any[]>((resolve) => {
        const out: any[] = [];
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            resolve(out);
            return;
          }
          out.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        };
        cursorReq.onerror = () => resolve([]);
      });

      db.close();
      return entries.some((entry) =>
        String(entry?.key).startsWith('note:') &&
        typeof entry?.value?.content === 'string' &&
        entry.value.content.includes(target)
      );
    },
    marker,
    { timeout: 10_000 },
  );
}

async function openDataSettings(page: import('@playwright/test').Page) {
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Data' }).click();
}

async function saveHistorySnapshotForNote(
  page: import('@playwright/test').Page,
  noteTitle: string,
  content: string,
) {
  await page.evaluate(async ({ title, snapshotContent }) => {
    type StoredNote = { id: string; title: string };

    const openDatabase = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const notesDb = await openDatabase('redaction-diary-notes-db');
    const note = await new Promise<StoredNote | null>((resolve, reject) => {
      const transaction = notesDb.transaction('notes', 'readonly');
      const request = transaction.objectStore('notes').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(null);
          return;
        }
        const value = cursor.value as Partial<StoredNote>;
        if (
          String(cursor.key).startsWith('note:') &&
          value.title === title &&
          typeof value.id === 'string'
        ) {
          resolve({ id: value.id, title });
          return;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    notesDb.close();
    if (!note) throw new Error(`Note "${title}" was not found.`);

    const savedAt = new Date().toISOString();
    const historyDb = await openDatabase('redaction-diary-history-db');
    await new Promise<void>((resolve, reject) => {
      const transaction = historyDb.transaction('history', 'readwrite');
      transaction.objectStore('history').put(
        { noteId: note.id, title: note.title, content: snapshotContent, savedAt },
        `history:${note.id}:${savedAt}`,
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    historyDb.close();
  }, { title: noteTitle, snapshotContent: content });
}

test('new note flow creates and persists a note', async ({ page }) => {
  const marker = `e2e-note-${Date.now()}`;
  await page.goto('/');

  await page.getByTitle('New note').click();
  await page.locator('.cm-content').last().click();
  await page.keyboard.type(`# ${marker}\n\nThis note verifies the create flow.`);

  await waitForMarkerPersisted(page, marker);
  await page.reload();
  await waitForMarkerPersisted(page, marker);
});

test('search returns a note by title and content', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Noa' })).toBeVisible();
  await page.getByTitle('Search notes').click();
  await page.getByPlaceholder('Search notes, tags...').fill('"Welcome to Noa"');
  await expect(page.getByText(/Search Results \([1-9]\d*\)/)).toBeVisible();
});

test('search icon closes an open search field on a second click', async ({ page }) => {
  await page.goto('/');

  const searchButton = page.getByTitle('Search notes');
  const searchInput = page.getByPlaceholder('Search notes, tags...');
  await searchButton.click();
  await searchInput.fill('Welcome');
  await expect(page.getByText(/Search Results \([1-9]\d*\)/)).toBeVisible();

  await searchButton.click();
  await expect(searchInput).toBeHidden();
  await expect(page.getByText(/Search Results \([1-9]\d*\)/)).toHaveCount(0);
});

test('tab strip occupies the title-bar row instead of leaving a second header row', async ({ page }) => {
  await page.goto('/');

  const [tabBox, searchBox, sidebarActionBox, rightPanelTabBox] = await Promise.all([
    page.locator('[data-tab-id]').first().boundingBox(),
    page.getByTitle('Search notes').boundingBox(),
    page.getByTitle('New note').boundingBox(),
    page.getByRole('button', { name: 'Tasks' }).boundingBox(),
  ]);

  expect(tabBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(sidebarActionBox).not.toBeNull();
  expect(rightPanelTabBox).not.toBeNull();
  expect(tabBox!.y).toBeLessThanOrEqual(searchBox!.y + 4);
  expect(sidebarActionBox!.y).toBeGreaterThanOrEqual(searchBox!.y + 24);
  // The panel tabs moved up into the title bar too, so they now share the row
  // with search rather than sitting a header row below it.
  expect(rightPanelTabBox!.y).toBeLessThanOrEqual(searchBox!.y + 4);
});

test('right panel keeps Tasks as the penultimate tab', async ({ page }) => {
  await page.goto('/');

  const tabs = page.locator('#noa-titlebar-panel-tabs button');
  await expect(tabs).toHaveCount(5);
  const labels = await tabs.evaluateAll((buttons) => (
    buttons.map((button) => button.getAttribute('aria-label'))
  ));

  expect(labels).toEqual(['Backlinks', 'Outgoing', 'Graph', 'Tasks', 'Properties']);
});

test('lifted title-bar tab controls opt out of the native drag region', async ({ page }) => {
  await page.goto('/');

  const appRegion = async (locator: import('@playwright/test').Locator) =>
    locator.evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region'));

  await expect(page.locator('[data-tab-id]').first()).toBeVisible();
  expect(await appRegion(page.locator('[data-tab-id]').first())).toBe('no-drag');
  expect(await appRegion(page.getByRole('button', { name: 'New tab' }))).toBe('no-drag');
});

test('expanded desktop search does not cover the first tab when the sidebar is closed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await page.getByRole('button', { name: 'Search notes' }).click();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));

  const [inputBox, tabBox] = await Promise.all([
    page.getByRole('textbox', { name: 'Search notes' }).boundingBox(),
    page.locator('[data-tab-id]').first().boundingBox(),
  ]);
  expect(inputBox).not.toBeNull();
  expect(tabBox).not.toBeNull();
  expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(tabBox!.x);
});

test('narrow desktop keeps the sidebar default stable on first pointer and keyboard resize', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto('/');

  const readSidebarWidth = () => page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--noa-sidebar-width')),
  );
  const separator = page.getByRole('separator', { name: 'Resize sidebar' });

  await expect.poll(readSidebarWidth).toBe(325);
  const separatorBox = await separator.boundingBox();
  expect(separatorBox).not.toBeNull();
  await page.mouse.move(separatorBox!.x + separatorBox!.width / 2, separatorBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(340, separatorBox!.y + 20);
  await page.mouse.up();
  await expect.poll(readSidebarWidth).toBe(325);

  await page.reload();
  await expect.poll(readSidebarWidth).toBe(325);
  await separator.focus();
  await separator.press('ArrowRight');
  await expect.poll(readSidebarWidth).toBe(325);
});

test('hovering the collapsed sidebar toggle previews the sidebar in its expanded position without changing layout state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  const sidebar = page.locator('.noa-sidebar-surface').first();
  const editor = page.locator('.cm-editor').first();

  const expandedSidebarBox = await sidebar.boundingBox();
  expect(expandedSidebarBox).not.toBeNull();
  const expandedSurface = page.locator('[data-sidebar-column-surface="true"]');
  await expect(expandedSurface).toBeVisible();
  expect(await expandedSurface.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: expandedSidebarBox!.width,
    height: 720,
  });
  expect(await sidebar.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(244, 244, 242)');
  await expect.poll(() => expandedSurface.evaluate((surface) => (
    getComputedStyle(surface).backgroundColor
      === getComputedStyle(document.querySelector<HTMLElement>('.noa-sidebar-surface')!).backgroundColor
  ))).toBe(true);
  await toggle.click();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  const collapsedEditorBox = await editor.boundingBox();
  expect(collapsedEditorBox).not.toBeNull();

  // Closing by click leaves the pointer over the toggle; preview begins only
  // after a genuine leave-and-reenter hover gesture.
  await page.mouse.move(700, 400);
  await toggle.hover();
  await expect(page.locator('[data-sidebar-preview="true"]')).toBeVisible();
  const previewShell = page.locator('[data-sidebar-preview-shell="true"]');
  await expect(previewShell).toBeVisible();
  await expect.poll(() => previewShell.evaluate((layer) => {
    const appShell = document.querySelector<HTMLElement>('.noa-app-shell');
    return appShell ? getComputedStyle(layer).backgroundColor === getComputedStyle(appShell).backgroundColor : false;
  })).toBe(true);
  await expect.poll(() => sidebar.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe('rgba(0, 0, 0, 0)');
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));

  const [previewShellBox, previewSidebarBox, previewEditorBox] = await Promise.all([
    previewShell.boundingBox(),
    sidebar.boundingBox(),
    editor.boundingBox(),
  ]);
  expect(previewShellBox).not.toBeNull();
  expect(previewSidebarBox).not.toBeNull();
  expect(previewEditorBox).not.toBeNull();
  expect(previewShellBox).toEqual({
    x: 0,
    y: 0,
    width: expandedSidebarBox!.width,
    height: 720,
  });
  expect(await previewShell.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.borderTopRightRadius, style.borderBottomRightRadius].every((radius) => parseFloat(radius) > 0);
  })).toBe(true);
  expect(await previewShell.evaluate((element) => getComputedStyle(element).boxShadow))
    .toBe('rgba(45, 45, 43, 0.07) 6px 0px 14px 0px');
  expect(previewSidebarBox).toEqual(expandedSidebarBox);
  expect(previewEditorBox).toEqual(collapsedEditorBox);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('app-sidebar-open'))).toBe('false');

  await sidebar.hover();
  await expect(page.locator('[data-sidebar-preview="true"]')).toBeVisible();

  await page.mouse.move(700, 400);
  await page.waitForTimeout(160);
  await expect(previewShell).toHaveAttribute('data-sidebar-preview-closing', 'true');
  await expect(page.locator('[data-sidebar-preview="true"]')).toBeVisible();
  await expect(page.locator('[data-sidebar-preview="true"]')).toHaveCount(0);
  await expect(previewShell).toHaveCount(0);
});

test('dark mode sidebar preview uses the main canvas plane without creating a titlebar seam', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app-settings', JSON.stringify({ appearance: { theme: 'dark' } }));
    localStorage.setItem('redaction-storage-notice-seen', '1');
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  const sidebar = page.locator('.noa-sidebar-surface').first();
  expect(await sidebar.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(42, 42, 40)');
  expect(await page.locator('[data-sidebar-column-surface="true"]').evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))).toBe('rgb(42, 42, 40)');
  await toggle.click();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  await page.mouse.move(700, 400);
  await toggle.hover();

  const previewShell = page.locator('[data-sidebar-preview-shell="true"]');
  await expect(previewShell).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  const palette = await previewShell.evaluate((shell) => {
    const rootStyle = getComputedStyle(document.documentElement);
    const sidebar = document.querySelector<HTMLElement>('.noa-sidebar-surface');
    const appShell = document.querySelector<HTMLElement>('.noa-app-shell');
    return {
      sidebarToken: rootStyle.getPropertyValue('--bg-sidebar').trim(),
      primaryToken: rootStyle.getPropertyValue('--bg-primary').trim(),
      previewColor: getComputedStyle(shell).backgroundColor,
      sidebarColor: sidebar ? getComputedStyle(sidebar).backgroundColor : null,
      primaryColor: appShell ? getComputedStyle(appShell).backgroundColor : null,
      previewShadow: getComputedStyle(shell).boxShadow,
      previewBounds: shell.getBoundingClientRect().toJSON(),
    };
  });

  expect(palette).toMatchObject({
    sidebarToken: '#2A2A28',
    primaryToken: '#2D2D2B',
    previewColor: 'rgb(45, 45, 43)',
    sidebarColor: 'rgba(0, 0, 0, 0)',
    primaryColor: 'rgb(45, 45, 43)',
    previewShadow: 'rgba(18, 18, 16, 0.14) 6px 0px 14px 0px',
    previewBounds: { x: 0, y: 0, height: 720 },
  });
});

test('clicking the sidebar toggle keeps the preview fixed while smoothly pushing the editor right', async ({ page }) => {
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  const sidebar = page.locator('.noa-sidebar-surface').first();
  const editor = page.locator('.cm-editor').first();
  const expandedSidebarBox = await sidebar.boundingBox();
  const expandedEditorBox = await editor.boundingBox();
  expect(expandedSidebarBox).not.toBeNull();
  expect(expandedEditorBox).not.toBeNull();

  await toggle.click();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  const collapsedEditorBox = await editor.boundingBox();
  expect(collapsedEditorBox).not.toBeNull();
  await page.mouse.move(700, 400);
  await toggle.hover();
  await expect(page.locator('[data-sidebar-preview="true"]')).toBeVisible();

  await toggle.click();
  const promotionMidpoint = await page.locator('[data-sidebar-promotion-spacer="true"]').evaluate(async (spacer) => {
    const animation = spacer.getAnimations()[0];
    if (!animation) throw new Error('Sidebar promotion animation did not start.');
    await animation.ready;
    animation.pause();
    const duration = Number(animation.effect?.getTiming().duration);
    animation.currentTime = duration / 2;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const sidebar = document.querySelector<HTMLElement>('.noa-sidebar-surface')!;
    const editor = document.querySelector<HTMLElement>('.cm-editor')!;
    const separator = document.querySelector<HTMLElement>('[data-sidebar-separator="true"]')!;
    const sample = {
      sidebarX: sidebar.getBoundingClientRect().x,
      separatorX: separator.getBoundingClientRect().x,
      editorX: editor.getBoundingClientRect().x,
    };
    animation.play();
    return sample;
  });

  expect(Math.abs(promotionMidpoint.sidebarX - expandedSidebarBox!.x)).toBeLessThan(0.5);
  expect(promotionMidpoint.editorX).toBeGreaterThan(collapsedEditorBox!.x);
  expect(promotionMidpoint.editorX).toBeLessThan(expandedEditorBox!.x);
  expect(Math.abs(promotionMidpoint.separatorX - (expandedSidebarBox!.x + expandedSidebarBox!.width))).toBeLessThan(0.5);
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  expect(await editor.boundingBox()).toEqual(expandedEditorBox);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-sidebar-preview="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('app-sidebar-open'))).toBe('true');
});

test('entering focus mode cancels an in-flight sidebar preview promotion', async ({ page }) => {
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  const editor = page.locator('.cm-editor').first();
  await toggle.click();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  const collapsedEditorBox = await editor.boundingBox();
  expect(collapsedEditorBox).not.toBeNull();

  await page.mouse.move(700, 400);
  await toggle.hover();
  await expect(page.locator('[data-sidebar-preview="true"]')).toBeVisible();
  await toggle.click();
  await page.keyboard.press('Meta+Shift+f');

  await expect(page.getByRole('button', { name: 'Esc' })).toBeVisible();
  expect(await page.locator('[data-sidebar-promotion-spacer="true"]').count()).toBe(0);
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  expect((await editor.boundingBox())!.x).toBe(collapsedEditorBox!.x);
});

test('direct sidebar toggle keeps the separator attached to the moving sidebar edge', async ({ page }) => {
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  const sidebar = page.locator('[data-sidebar-container]');
  const separator = page.locator('[data-sidebar-separator="true"]');
  const expandedSidebarBox = await sidebar.boundingBox();
  expect(expandedSidebarBox).not.toBeNull();

  const sampleEdgeMidpoint = async () => sidebar.evaluate(async (element) => {
    const separator = document.querySelector<HTMLElement>('[data-sidebar-separator="true"]')!;
    const surface = document.querySelector<HTMLElement>('[data-sidebar-column-surface="true"]')!;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const animations = [element, separator, surface].flatMap((target) => target.getAnimations());
    if (animations.length === 0) throw new Error('Direct sidebar transition did not start.');
    await Promise.all(animations.map((animation) => animation.ready));
    animations.forEach((animation) => {
      animation.pause();
      animation.currentTime = Number(animation.effect?.getTiming().duration) / 2;
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const box = element.getBoundingClientRect();
    const sample = {
      edge: box.right,
      surfaceEdge: surface.getBoundingClientRect().right,
      separator: separator.getBoundingClientRect().x,
      opacity: Number(getComputedStyle(separator).opacity),
    };
    animations.forEach((animation) => animation.play());
    return sample;
  });

  await toggle.click();
  const closing = await sampleEdgeMidpoint();
  expect(closing.edge).toBeGreaterThan(expandedSidebarBox!.x);
  expect(closing.edge).toBeLessThan(expandedSidebarBox!.x + expandedSidebarBox!.width);
  expect(Math.abs(closing.edge - closing.separator)).toBeLessThan(1.5);
  expect(Math.abs(closing.edge - closing.surfaceEdge)).toBeLessThan(1.5);
  expect(closing.opacity).toBe(1);
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  await expect(separator).toHaveCSS('opacity', '0');

  await toggle.evaluate((element) => (element as HTMLButtonElement).click());
  const opening = await sampleEdgeMidpoint();
  expect(opening.edge).toBeGreaterThan(expandedSidebarBox!.x);
  expect(opening.edge).toBeLessThan(expandedSidebarBox!.x + expandedSidebarBox!.width);
  expect(Math.abs(opening.edge - opening.separator)).toBeLessThan(1.5);
  expect(Math.abs(opening.edge - opening.surfaceEdge)).toBeLessThan(1.5);
  expect(opening.opacity).toBe(1);
});

test('Escape closes the sidebar preview and returns focus to its toggle', async ({ page }) => {
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  await toggle.click();
  await page.mouse.move(700, 400);
  await toggle.hover();
  await expect(page.locator('[data-sidebar-preview="true"]')).toBeVisible();

  await page.getByRole('button', { name: 'New note' }).focus();
  await page.keyboard.press('Escape');

  await expect(page.locator('[data-sidebar-preview="true"]')).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect(page.locator('[data-sidebar-container]')).toHaveAttribute('inert', '');
});

test('expanded sidebar surface follows the resize edge without a trailing transition', async ({ page }) => {
  await page.goto('/');

  const sidebar = page.locator('[data-sidebar-container]');
  const surface = page.locator('[data-sidebar-column-surface="true"]');
  const separator = page.getByRole('separator', { name: 'Resize sidebar' });
  const separatorBox = await separator.boundingBox();
  expect(separatorBox).not.toBeNull();

  await page.mouse.move(separatorBox!.x + separatorBox!.width / 2, separatorBox!.y + 40);
  await page.mouse.down();
  await page.mouse.move(420, separatorBox!.y + 40);

  const edges = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('[data-sidebar-container]')!;
    const surface = document.querySelector<HTMLElement>('[data-sidebar-column-surface="true"]')!;
    const divider = document.querySelector<HTMLElement>('[data-sidebar-separator="true"]')!;
    return {
      sidebar: sidebar.getBoundingClientRect().right,
      surface: surface.getBoundingClientRect().right,
      divider: divider.getBoundingClientRect().x,
    };
  });

  expect(Math.abs(edges.sidebar - edges.surface)).toBeLessThan(1.5);
  expect(Math.abs(edges.sidebar - edges.divider)).toBeLessThan(1.5);
  await page.mouse.up();
});

test('a second toggle during preview promotion reverses without moving the editor discontinuously', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  const editor = page.locator('.cm-editor').first();
  await toggle.click();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  const collapsedEditorX = (await editor.boundingBox())!.x;
  await page.mouse.move(700, 400);
  await toggle.hover();
  await toggle.click();

  const editorBeforeReverse = await page.locator('[data-sidebar-promotion-spacer="true"]').evaluate(async (spacer) => {
    const animation = spacer.getAnimations()[0];
    if (!animation) throw new Error('Sidebar promotion animation did not start.');
    await animation.ready;
    animation.pause();
    animation.currentTime = Number(animation.effect?.getTiming().duration) / 2;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return document.querySelector<HTMLElement>('.cm-editor')!.getBoundingClientRect().x;
  });

  await toggle.click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const editorAfterReverse = (await editor.boundingBox())!.x;
  expect(Math.abs(editorAfterReverse - editorBeforeReverse)).toBeLessThan(12);
  const reverseSurface = await page.locator('[data-sidebar-column-surface="true"]').boundingBox();
  expect(reverseSurface).not.toBeNull();
  expect(reverseSurface!.width).toBeGreaterThan(300);
  await expect(page.locator('[data-sidebar-promotion-spacer="true"]')).toHaveCount(0);
  const handoff = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('[data-sidebar-container]')!;
    const editor = document.querySelector<HTMLElement>('.cm-editor')!;
    return {
      editorX: editor.getBoundingClientRect().x,
      sidebarAnimations: sidebar.getAnimations().map((animation) => (
        animation instanceof CSSTransition ? animation.transitionProperty : null
      )),
    };
  });
  expect(Math.abs(handoff.editorX - collapsedEditorX)).toBeLessThan(12);
  expect(handoff.sidebarAnimations).not.toContain('margin-left');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('resizing a preview keeps it open until the pointer is released', async ({ page }) => {
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  await toggle.click();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  await page.mouse.move(700, 400);
  await toggle.hover();

  const resize = page.getByRole('separator', { name: 'Resize sidebar' });
  const resizeBox = await resize.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + 60);
  await page.mouse.down();
  await page.mouse.move(420, resizeBox!.y + 60);

  await page.waitForTimeout(360);
  await expect(page.locator('[data-sidebar-preview="true"]')).toBeVisible();
  await expect(page.locator('[data-sidebar-preview-closing="true"]')).toHaveCount(0);
  await page.mouse.up();
});

test('reversing a preview exit continues from its current visual progress', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  await toggle.click();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  await page.mouse.move(700, 400);
  await toggle.hover();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  await page.mouse.move(700, 400);
  await page.waitForTimeout(150);
  const shell = page.locator('[data-sidebar-preview-shell="true"]');
  expect(await shell.getAttribute('data-sidebar-preview-closing')).toBe('true');

  const opacityBeforeReverse = await shell.evaluate(async (element) => {
    const animation = element.getAnimations()[0];
    if (!animation) throw new Error('Sidebar exit animation did not start.');
    await animation.ready;
    animation.pause();
    animation.currentTime = Number(animation.effect?.getTiming().duration) / 2;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return Number(getComputedStyle(element).opacity);
  });

  await toggle.hover();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const opacityAfterReverse = Number(await shell.evaluate((element) => getComputedStyle(element).opacity));
  expect(Math.abs(opacityAfterReverse - opacityBeforeReverse)).toBeLessThan(0.15);
  await expect(shell).not.toHaveAttribute('data-sidebar-preview-closing', 'true');
});

test('enabling reduced motion settles active sidebar preview transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  await toggle.click();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  await page.mouse.move(700, 400);
  await toggle.hover();
  await page.mouse.move(700, 400);
  await page.waitForTimeout(150);
  expect(await page.locator('[data-sidebar-preview-shell="true"]').getAttribute('data-sidebar-preview-closing')).toBe('true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-sidebar-preview="true"]')).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await toggle.hover();
  await toggle.click();
  await expect(page.locator('[data-sidebar-promotion-spacer="true"]')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-sidebar-promotion-spacer="true"]')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('expanded mobile search keeps its clear button above the title-bar actions', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Search notes' }).click();
  const searchInput = page.getByRole('textbox', { name: 'Search notes' });
  await searchInput.fill('Welcome');
  await searchInput.locator('..').evaluate(async (container) => {
    await Promise.all(container.getAnimations().map((animation) => animation.finished));
  });

  const clearButton = page.getByRole('button', { name: 'Clear search' });
  const [inputBox, clearBox] = await Promise.all([
    searchInput.boundingBox(),
    clearButton.boundingBox(),
  ]);
  expect(inputBox).not.toBeNull();
  expect(clearBox).not.toBeNull();
  expect(inputBox!.width).toBeGreaterThanOrEqual(80);
  const topmostControl = await page.evaluate(({ x, y }) => {
    return document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null;
  }, {
    x: clearBox!.x + clearBox!.width / 2,
    y: clearBox!.y + clearBox!.height / 2,
  });
  expect(topmostControl).toBe('Clear search');
});

test('Cmd+F exits focus mode and focuses the mounted search input', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Search notes' })).toBeVisible();
  await page.keyboard.press('Meta+Shift+f');
  await expect(page.getByRole('button', { name: 'Search notes' })).toHaveCount(0);

  await page.keyboard.press('Meta+f');
  const searchInput = page.getByRole('textbox', { name: 'Search notes' });
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeFocused();
});

test('cyclic view control exposes the current editor mode', async ({ page }) => {
  await page.goto('/');

  const modeButton = page.getByRole('button', { name: /Switch to (edit|split|preview) view/ });
  await expect(modeButton).toHaveAttribute('aria-description', 'Current view: split');
  await modeButton.click();
  await expect(modeButton).toHaveAttribute('aria-description', 'Current view: preview');
});

test('right panel toggle remains clickable after the panel is collapsed', async ({ page }) => {
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle right panel' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300);

  const toggleBox = await toggle.boundingBox();
  expect(toggleBox).not.toBeNull();
  const topmostControl = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element?.closest('button')?.getAttribute('aria-label') ?? null;
  }, {
    x: toggleBox!.x + toggleBox!.width / 2,
    y: toggleBox!.y + toggleBox!.height / 2,
  });
  expect(topmostControl).toBe('Toggle right panel');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('app chrome prevents accidental text selection while content remains selectable', async ({ page }) => {
  await page.goto('/');

  const userSelect = async (locator: import('@playwright/test').Locator) =>
    locator.evaluate((element) => getComputedStyle(element).userSelect);

  await expect(page.locator('.noa-app-shell')).toBeVisible();
  expect(await userSelect(page.locator('.noa-app-shell'))).toBe('none');
  expect(await userSelect(page.getByTitle('Double-click to rename'))).toBe('none');
  await page.getByTitle('Search notes').click();
  expect(await userSelect(page.getByPlaceholder('Search notes, tags...'))).toBe('text');
  const editorContent = page.locator('.cm-content').last();
  expect(await userSelect(editorContent)).toBe('text');
  await editorContent.evaluate((element) => element.setAttribute('contenteditable', 'false'));
  expect(await userSelect(editorContent)).toBe('text');
  expect(await userSelect(page.locator('.noa-selectable').first())).toBe('text');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Editor' }).click();
  expect(await userSelect(page.getByPlaceholder('# {{date}}\n\n## Notes\n\n'))).toBe('text');
  await page.getByRole('tab', { name: 'Appearance' }).click();
  expect(await userSelect(page.getByRole('heading', { name: 'Theme' }))).toBe('none');
});

test('version history content remains selectable', async ({ page }) => {
  const marker = `history-selection-${Date.now()}`;
  await page.goto('/');

  // Version History moved out of the toolbar into the editor overflow menu, so
  // it is a menuitem now and no longer carries a title attribute of its own.
  const toggleHistory = async () => {
    await page.getByTitle('More actions').click();
    await page.getByRole('menuitem', { name: 'Version History' }).click();
  };

  await toggleHistory();
  await expect(page.getByText('No history yet.', { exact: false })).toBeVisible();
  await toggleHistory();

  await saveHistorySnapshotForNote(page, 'Welcome to Noa', marker);

  await toggleHistory();
  const historyText = page.getByText(marker, { exact: true });
  await historyText.first().click();
  await expect(historyText).toHaveCount(2);
  expect(await historyText.last().evaluate((element) => getComputedStyle(element).userSelect)).toBe('text');
});

test('graph controls keep visible keyboard focus and hover feedback', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app-settings', JSON.stringify({ appearance: { theme: 'light' } }));
    localStorage.setItem('app-right-panel-open', 'true');
    localStorage.setItem('app-right-tab', 'graph');
    localStorage.setItem('redaction-storage-notice-seen', '1');
    localStorage.setItem('app-graph-guide-seen', '1');
  });
  await page.goto('/');

  // The filter cluster no longer has a frame to tint on focus — it reads as a
  // field from an accent wash instead. Focus is now carried by the global
  // input:focus-visible rule in index.css, so assert the affordance that
  // actually renders rather than the group border that used to.
  const input = page.getByPlaceholder('filter...');
  await input.focus();
  await expect(input).toHaveCSS('outline-style', 'solid');
  await expect(input).toHaveCSS('outline-width', '2px');
  await expect(input).toHaveCSS('outline-color', 'rgb(204, 125, 94)');

  const zoomIn = page.getByTitle('Zoom in');
  await zoomIn.hover();
  await expect(zoomIn).toHaveCSS('color', 'rgb(204, 125, 94)');
});

test('legacy Graph View preference cannot hide the graph tab', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app-settings', JSON.stringify({ corePlugins: { graphView: false } }));
    localStorage.setItem('app-right-panel-open', 'true');
    localStorage.setItem('app-right-tab', 'graph');
    localStorage.setItem('redaction-storage-notice-seen', '1');
  });
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Graph', exact: true })).toBeVisible();
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Editor' }).click();
  await expect(page.getByRole('switch', { name: 'Graph View' })).toHaveCount(0);
});

test('graph nodes expose a keyboard navigation surface', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app-right-panel-open', 'true');
    localStorage.setItem('app-right-tab', 'graph');
    localStorage.setItem('redaction-storage-notice-seen', '1');
    localStorage.setItem('app-graph-guide-seen', '1');
  });
  await page.goto('/');

  const nodeNavigation = page.getByRole('navigation', { name: 'Graph nodes' });
  const node = nodeNavigation.getByRole('button').first();
  const nodeName = (await node.textContent())?.trim();
  expect(nodeName).toBeTruthy();
  await node.focus();
  await expect(node).toBeVisible();
  await node.press('Enter');
  await expect(page.getByTitle('Double-click to rename')).toHaveText(nodeName!);
});

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

test('restored-open right panel waits until the post-load animation frame', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app-right-panel-open', 'true');
    localStorage.setItem('app-right-tab', 'tasks');
    localStorage.setItem('redaction-storage-notice-seen', '1');

    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const queuedFrames: FrameRequestCallback[] = [];
    let holdFrames = true;

    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      if (!holdFrames) return nativeRequestAnimationFrame(callback);
      queuedFrames.push(callback);
      return queuedFrames.length;
    };

    (window as Window & { __flushNoaAnimationFrames?: () => void }).__flushNoaAnimationFrames = () => {
      holdFrames = false;
      const timestamp = performance.now();
      queuedFrames.splice(0).forEach((callback) => callback(timestamp));
    };
  });

  await page.goto('/');
  await expect(page.getByTitle('Search notes')).toBeVisible();
  await expect(page.locator('[data-noa-right-panel-content]')).toHaveCount(0);

  await page.evaluate(() => {
    (window as Window & { __flushNoaAnimationFrames?: () => void }).__flushNoaAnimationFrames?.();
  });
  await expect(page.locator('[data-noa-right-panel-content]')).toHaveCount(1);
});

test('graph canvas backing size remains stable during horizontal window resize', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.addInitScript(() => {
    localStorage.setItem('app-right-panel-open', 'true');
    localStorage.setItem('app-right-tab', 'graph');
    localStorage.setItem('redaction-storage-notice-seen', '1');
    localStorage.setItem('app-graph-guide-seen', '1');
  });

  await page.goto('/');
  await page.waitForSelector('canvas');

  const samples: Array<{ panelWidth: number; canvasWidth: number }> = [];
  for (const width of [1100, 1060, 1020, 980, 940, 900, 880]) {
    await page.setViewportSize({ width, height: 760 });
    await page.waitForTimeout(35);
    samples.push(await page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
      const panel = document.querySelector('[aria-label="Graph"]')?.closest('.w-full.h-full');
      return {
        panelWidth: Math.round(panel?.getBoundingClientRect().width ?? 0),
        canvasWidth: canvas?.width ?? 0,
      };
    }));
  }

  expect([...new Set(samples.map((sample) => sample.canvasWidth))]).toHaveLength(1);
  expect(Math.min(...samples.map((sample) => sample.canvasWidth))).toBeGreaterThanOrEqual(
    Math.max(...samples.map((sample) => sample.panelWidth)),
  );
});

test('export json downloads a valid backup file', async ({ page }) => {
  await page.goto('/');
  await openDataSettings(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const raw = await readFile(downloadPath as string, 'utf8');
  const parsed = JSON.parse(raw) as { notes?: unknown[]; folders?: unknown[] };
  expect(Array.isArray(parsed.notes)).toBe(true);
  expect(Array.isArray(parsed.folders)).toBe(true);
});

test('import json restores notes from a backup file', async ({ page }) => {
  const marker = `e2e-import-${Date.now()}`;
  await page.goto('/');
  await openDataSettings(page);

  const backup = {
    notes: [
      {
        id: `note-${Date.now()}`,
        title: marker,
        content: `# ${marker}\n\nImported note body.`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        folder: '',
        tags: [],
        links: [],
      },
    ],
    folders: [],
    workspaceName: 'Imported Workspace',
  };

  await page.locator('input[type="file"][accept=".json"]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup), 'utf8'),
  });

  await expect(page.getByText(/This may replace existing data/i)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/Imported 1 notes/i)).toBeVisible();

  await page.reload();
  await waitForMarkerPersisted(page, marker);
  await expect(page.getByText(marker, { exact: false })).toBeVisible();
});

test('settings modal closes with escape and backdrop click', async ({ page }) => {
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toBeHidden();

  await page.getByTitle('Settings').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.locator('[role="dialog"]')).toBeHidden();
});

test('settings tabs support keyboard navigation', async ({ page }) => {
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
});

test('settings remembers the last active tab when reopened', async ({ page }) => {
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'About' }).click();
  await expect(page.getByRole('button', { name: 'Export Diagnostics' })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('[role="dialog"]')).toBeHidden();

  await page.getByTitle('Settings').click();
  await expect(page.getByRole('button', { name: 'Export Diagnostics' })).toBeVisible();
});

test('appearance settings persist after a full reload', async ({ page }) => {
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  const selects = page.getByRole('combobox');
  await selects.nth(0).selectOption('dark');
  await selects.nth(1).selectOption('font-redaction');
  await expect(selects.nth(0)).toHaveValue('dark');
  await expect(selects.nth(1)).toHaveValue('font-redaction');

  await page.reload();
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await expect(page.getByRole('combobox').nth(0)).toHaveValue('dark');
  await expect(page.getByRole('combobox').nth(1)).toHaveValue('font-redaction');
});

test('translucent sidebar persists and keeps its material through the closing motion', async ({ page }) => {
  await page.goto('/');

  const root = page.locator('html');
  const separator = page.locator('[data-sidebar-separator="true"]');
  await expect(root).toHaveAttribute('data-translucent-sidebar', 'disabled');
  await expect(separator).toHaveCSS('z-index', '30');
  await expect.poll(() => separator.evaluate((element) => getComputedStyle(element).filter))
    .toContain('drop-shadow');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  const translucentSwitch = page.getByRole('switch', { name: 'Translucent sidebar' });
  await expect(translucentSwitch).not.toBeChecked();
  await translucentSwitch.click();
  await expect(translucentSwitch).toBeChecked();
  await page.getByRole('button', { name: 'Close settings' }).click();

  const shell = page.locator('.noa-app-shell');
  const column = page.locator('[data-sidebar-column-surface="true"]');
  await expect(root).toHaveAttribute('data-translucent-sidebar', 'enabled');
  await expect(column).toHaveAttribute('data-sidebar-expanded', 'true');
  await expect.poll(() => column.evaluate((element) => getComputedStyle(element).backdropFilter))
    .toBe('none');
  await expect.poll(() => separator.evaluate((element) => getComputedStyle(element).filter))
    .toContain('drop-shadow');

  await page.reload();
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await expect(page.getByRole('switch', { name: 'Translucent sidebar' })).toBeChecked();
  await page.getByRole('button', { name: 'Close settings' }).click();

  await page.getByTitle('Toggle Sidebar').click();
  await expect(column).toHaveAttribute('data-sidebar-expanded', 'true');
  await expect(shell).toHaveCSS('transition-property', '--noa-sidebar-material-width');
  await expect.poll(() => shell.evaluate((element) => (
    (element as HTMLElement).style.getPropertyValue('--noa-sidebar-material-width')
  ))).toBe('0px');
  await page.waitForTimeout(260);
  await expect(column).not.toHaveAttribute('data-sidebar-expanded', 'true');

  await page.mouse.move(700, 500);
  await page.getByTitle('Toggle Sidebar').hover();
  await expect(page.locator('[data-sidebar-preview-shell="true"]')).toBeVisible();
  await expect(column).not.toHaveAttribute('data-sidebar-expanded', 'true');
});

test('closing the mobile sidebar does not leave desktop material state active', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('redaction-storage-notice-seen', '1');
  });
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.goto('/');

  const toggle = page.getByTitle('Toggle Sidebar');
  const sidebar = page.locator('[data-sidebar-container]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 700, height: 760 });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
  await page.waitForTimeout(50);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(260);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(260);

  await sidebar.evaluate((element) => {
    const expandedStates: Array<string | null> = [];
    const observer = new MutationObserver(() => {
      expandedStates.push(element.getAttribute('data-sidebar-expanded'));
    });
    observer.observe(element, { attributes: true, attributeFilter: ['data-sidebar-expanded'] });
    (window as typeof window & { __sidebarExpandedStates?: Array<string | null> }).__sidebarExpandedStates = expandedStates;
  });
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.waitForTimeout(300);
  const expandedStates = await page.evaluate(() => (
    (window as typeof window & { __sidebarExpandedStates?: Array<string | null> }).__sidebarExpandedStates ?? []
  ));
  expect(expandedStates).not.toContain('true');
  expect(await sidebar.getAttribute('data-sidebar-expanded')).toBeNull();
});

test('translucent sidebar material does not animate with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('app-settings', JSON.stringify({
      appearance: { translucentSidebar: true },
    }));
  });
  await page.goto('/');

  const shell = page.locator('.noa-app-shell');
  await expect(page.locator('html')).toHaveAttribute('data-translucent-sidebar', 'enabled');
  await expect(shell).toHaveCSS('transition-property', 'none');
  await page.getByTitle('Toggle Sidebar').click();
  await expect(shell).toHaveCSS('transition-property', 'none');
});

test('a recovered settings read merges and persists a queued change', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('redaction-storage-notice-seen', '1');
    localStorage.setItem('app-settings', JSON.stringify({
      appearance: { theme: 'light' },
      templates: {
        userTemplates: [{
          id: 'keep-template',
          name: 'Keep',
          content: 'important',
          createdAt: '2026-01-01',
        }],
      },
      backup: { autoBackupEnabled: true },
    }));
    const realGetItem = Storage.prototype.getItem;
    (window as typeof window & { __allowSettingsRead?: boolean }).__allowSettingsRead = false;
    Storage.prototype.getItem = function getItem(key: string) {
      if (key === 'app-settings'
        && !(window as typeof window & { __allowSettingsRead?: boolean }).__allowSettingsRead) {
        throw new DOMException('temporary', 'SecurityError');
      }
      return realGetItem.call(this, key);
    };
  });
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('combobox').nth(0).selectOption('dark');
  await page.evaluate(() => {
    (window as typeof window & { __allowSettingsRead?: boolean }).__allowSettingsRead = true;
  });

  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('app-settings') ?? '{}');
    return saved.appearance?.theme;
  })).toBe('dark');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('app-settings') ?? '{}'));
  expect(persisted.appearance.theme).toBe('dark');
  expect(persisted.templates.userTemplates).toEqual([{
    id: 'keep-template',
    name: 'Keep',
    content: 'important',
    createdAt: '2026-01-01',
  }]);
  expect(persisted.backup.autoBackupEnabled).toBe(true);
});

test('settings keeps primary controls inside the dialog at narrower widths', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 700 });
  await page.goto('/');

  await page.getByTitle('Settings').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await page.getByRole('tab', { name: 'Appearance' }).click();

  const dialogBox = await dialog.boundingBox();
  const themeSelectBox = await page.getByRole('combobox').first().boundingBox();

  expect(dialogBox).not.toBeNull();
  expect(themeSelectBox).not.toBeNull();
  if (!dialogBox || !themeSelectBox) {
    throw new Error('Settings dialog geometry could not be measured.');
  }

  expect(themeSelectBox.x + themeSelectBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
});
