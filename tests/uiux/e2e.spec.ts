import { expect, test } from '../fixtures';

test('template dialog contains keyboard focus and returns it on Escape', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('redaction-storage-notice-seen', '1');
    localStorage.setItem('app-settings', JSON.stringify({
      templates: { userTemplates: [{ id: 'sample', name: 'Sample', content: 'Sample body', createdAt: '2026-01-01' }] },
    }));
  });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'New note', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Choose template' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button').last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByPlaceholder('Type a command or note title...')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('command palette wraps focus and closes from a result button', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('duplicate-note dialog wraps focus, restores focus and selects the requested note', async ({ page }) => {
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import Dialog from '/src/components/NavigationConflictDialog.tsx';
      import '/src/index.css';
      function Harness() {
        const [open, setOpen] = React.useState(false);
        const [selected, setSelected] = React.useState('');
        return React.createElement(React.Fragment, null,
          React.createElement('button', { onClick: () => setOpen(true) }, 'Open duplicate link'),
          React.createElement('output', null, selected),
          open && React.createElement(Dialog, {
            title: 'Same title', noteIds: ['one', 'two'],
            notes: [{ id: 'one', title: 'Same title', folder: 'a', createdAt: '2026-01-01' },
                    { id: 'two', title: 'Same title', folder: 'b', createdAt: '2026-01-01' }],
            folderNameById: new Map([['a', 'Folder A'], ['b', 'Folder B']]),
            onClose: () => setOpen(false),
            onSelect: id => { setSelected(id); setOpen(false); },
          }));
      }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
    `,
  }));
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Open duplicate link' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Choose a note' });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: /Folder B/ }).click();
  await expect(page.locator('output')).toHaveText('two');
  await expect(dialog).toBeHidden();
});

for (const { theme, width } of [{ theme: 'light', width: 1280 }, { theme: 'dark', width: 390 }]) {
test(`simultaneous notices do not overlap (${theme}, ${width}px)`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 720 });
  await page.addInitScript(theme => {
    localStorage.setItem('app-settings', JSON.stringify({ appearance: { theme } }));
  }, theme);
  await page.goto('/');
  await expect(page.getByText('Local storage only', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'notes') throw new DOMException('Test quota exhausted', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.keyboard.press('ControlOrMeta+n');
  const notices = page.getByRole('region', { name: 'Notifications' });
  const failure = notices.getByRole('alert');
  await expect(failure).toContainText('Failed to save note');
  const boxes = await notices.locator(':scope > div').evaluateAll(elements => elements.map(element => {
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  }));
  expect(boxes).toHaveLength(2);
  expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top);
  expect(boxes[0].left).toBe(boxes[1].left);
  expect(boxes[0].left).toBeGreaterThanOrEqual(0);
  expect(boxes[0].right).toBeLessThanOrEqual(width);
  await page.screenshot({ path: testInfo.outputPath('notifications.png') });
  await failure.getByRole('button', { name: 'Dismiss' }).click();
  await expect(failure).toBeHidden();
  await expect(notices.getByText('Local storage only', { exact: true })).toBeVisible();
});
}

test.describe('setup keyboard behavior', () => {
  test.use({ vaultOnboarding: 'shown' });
  test('setup contains focus and Escape keeps notes in Noa', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Connect a Markdown folder' });
    await expect(dialog).toBeFocused();
    await expect(dialog).toContainText('New notes created in Noa stay in this app');
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button').last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Local storage only', { exact: true })).toBeVisible();
  });
});
