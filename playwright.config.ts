import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT || '3456';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'ar-SA',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/e2e-serve.mjs',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
