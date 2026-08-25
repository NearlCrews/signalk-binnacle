import { defineConfig, devices } from '@playwright/test';

import { FIXTURE_ORIGIN, FIXTURE_PORT } from './e2e/helpers';

const PREVIEW_ORIGIN = 'http://localhost:4173/signalk-binnacle/';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Two workers, file-level parallelism only (fullyParallel stays at its false default): tests
  // within a spec file run in order in one worker, so mariner-helm's stateful fixture scenarios
  // keep their sequence while an independent file runs in the other worker against the stateless
  // preview origin. The gate is the dominant cost of every push, so the second worker pays for
  // itself; drop back to 1 if contention ever makes the specs flaky.
  workers: 2,
  // Playwright's default is 30 seconds, tuned for CI-class hardware. Several of these specs boot the
  // map, wait for a style and its overlays, and then interact, which takes about 29 seconds on the
  // Raspberry Pi 5 this project develops on: repeated runs of one spec measured 29.0, 29.1, and
  // 29.8 seconds, so whether the gate passed was decided by fractions of a second of machine load
  // rather than by anything the test asserts. CI retries once and hides it; the local pre-push hook
  // does not, and it blocked a push on it. This is a hang watchdog, not a performance assertion,
  // and every expect() keeps its own much shorter timeout, so doubling it costs no coverage.
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: PREVIEW_ORIGIN,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // Recording video for all 89 tests costs ffmpeg encoding on every green gate that then keeps
    // nothing; locally a failure still leaves a screenshot and can be re-run with --trace on.
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  webServer: [
    {
      command: 'npm run preview',
      url: PREVIEW_ORIGIN,
      // Never trust a process already on this port: it may be an unrelated server or a stale build.
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      // The Signal K stream fixture: the app's delta WebSocket opens inside the Comlink worker,
      // which Playwright's routeWebSocket cannot intercept, so the mariner project runs against
      // this real server (static build plus /signalk/v1/stream plus an HTTP control channel).
      command: 'npm run e2e:fixture',
      env: { SIGNALK_FIXTURE_PORT: String(FIXTURE_PORT) },
      // 127.0.0.1, not localhost: the fixture binds IPv4 only, and localhost can resolve to ::1.
      url: FIXTURE_ORIGIN,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
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
      testIgnore: [/pwa\.spec\.ts/, /webkit-smoke\.spec\.ts/, /mariner-.*\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The mariner helm scenarios run against the stream fixture origin, not the plain preview,
      // so they can drive live Signal K deltas (MOB, collision, staleness) through the worker.
      name: 'mariner',
      testMatch: /mariner-helm\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: FIXTURE_ORIGIN,
      },
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
