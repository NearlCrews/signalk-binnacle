import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Serial execution: the smoke test starts the preview server and navigates to the app root.
  // If more e2e tests are added that share server state, keep this serial; if they become truly
  // independent (each does a fresh page.goto), parallel execution could be safe.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/signalk-binnacle/',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/signalk-binnacle/',
    // Never trust a process already on this port: it may be an unrelated server or a stale build.
    reuseExistingServer: false,
    timeout: 120000,
  },
  // Firefox is deliberately absent: Chromium and WebKit cover the engine spread Binnacle
  // targets (Chrome, Edge, and Safari on helm tablets and phones), and Gecko is not a
  // default browser on any marine tablet. Revisit if a Firefox-specific defect is reported.
  projects: [
    {
      name: 'webkit-smoke',
      testMatch: /webkit-smoke\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'chromium',
      testIgnore: [/pwa\.spec\.ts/, /webkit-smoke\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit-ui',
      testMatch: /ui-quality\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-webkit-ui',
      testMatch: /ui-quality\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'chromium-pwa',
      testMatch: /pwa\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        serviceWorkers: 'allow',
      },
    },
  ],
});
