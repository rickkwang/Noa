import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Runs the suite against the locally installed Google Chrome instead of the
// bundled Chromium, for machines where `npx playwright install` cannot fetch it.
// The whole suite passes here, including the File System Access vault tests, so
// .githooks/pre-push falls back to this config instead of skipping e2e. CI stays
// on the bundled build — that is the engine results are guaranteed against.
export default defineConfig({
  ...base,
  use: { ...base.use, channel: 'chrome' },
});
