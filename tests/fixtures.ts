import { test as base } from '@playwright/test';
import { STORAGE_KEYS } from '../src/constants/storageKeys';

/**
 * f11ab59 put a modal in front of first launch: with no vault handle stored,
 * `showVaultOnboarding` is true and `VaultOnboardingDialog` covers the app
 * behind a `fixed inset-0` scrim. Every spec that reaches for a control on
 * first paint — which is nearly all of them — had its clicks swallowed by that
 * scrim and failed on the 30s timeout rather than on its own assertion.
 *
 * The dialog reads one localStorage flag, so seeding it before page scripts run
 * restores the pre-onboarding starting state without touching app code or the
 * ~80 `page.goto('/')` call sites.
 *
 * Specs that are *about* first launch opt out with
 * `test.use({ vaultOnboarding: 'shown' })` and drive the dialog themselves.
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
