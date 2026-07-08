import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Serial execution: the smoke test starts the preview server and navigates to the app root.
  // If more e2e tests are added that share server state, keep this serial; if they become truly
  // independent (each does a fresh page.goto), parallel execution could be safe.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/signalk-binnacle/',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/signalk-binnacle/',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
