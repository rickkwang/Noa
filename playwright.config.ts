import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browserExecutablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  || (process.platform === 'darwin' && existsSync(macChromePath) ? macChromePath : undefined);

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/smoke.spec.ts', '**/e2e.spec.ts', '**/hook-regressions.spec.ts'],
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    launchOptions: browserExecutablePath ? { executablePath: browserExecutablePath } : undefined,
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
