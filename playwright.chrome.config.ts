import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Runs the suite on the locally installed Google Chrome, for machines where
// `npx playwright install` can't fetch Chromium. .githooks/pre-push falls back to
// this config instead of skipping e2e. CI stays on the bundled Chromium, the engine results are guaranteed against.
export default defineConfig({
  ...base,
  use: { ...base.use, channel: 'chrome' },
});
