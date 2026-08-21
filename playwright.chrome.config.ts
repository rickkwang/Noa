import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Runs the suite against the locally installed Google Chrome instead of the
// bundled Chromium, for machines where `npx playwright install` cannot fetch
// it. Not a replacement for playwright.config.ts: the File System Access vault
// tests need the bundled build and fail here on a clean tree too.
export default defineConfig({
  ...base,
  use: { ...base.use, channel: 'chrome' },
});
