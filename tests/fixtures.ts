import { test as base } from '@playwright/test';
import { STORAGE_KEYS } from '../src/constants/storageKeys';

/**
 * First-launch onboarding covers the app with a fixed scrim, which swallows
 * clicks on first paint. Seeding its localStorage flag before page scripts run
 * skips it for every spec. Specs about first launch opt out with
 * `test.use({ vaultOnboarding: 'shown' })`.
 */
export const test = base.extend<{ vaultOnboarding: 'dismissed' | 'shown' }>({
  vaultOnboarding: ['dismissed', { option: true }],

  page: async ({ page, vaultOnboarding }, use) => {
    if (vaultOnboarding === 'dismissed') {
      await page.addInitScript((key: string) => {
        try { localStorage.setItem(key, 'true'); } catch { /* private mode */ }
      }, STORAGE_KEYS.VAULT_ONBOARDING_SEEN);
    }
    await use(page);
  },
});

export { expect } from '@playwright/test';
