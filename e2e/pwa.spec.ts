import { expect, test } from '@playwright/test';
import {
  cachedArchive,
  expectFixtureChart,
  installChartFixture,
  warmFixtureBaseStyle,
} from './chart-fixtures';
import { installMapLibreWorkerProof } from './maplibre-worker-proof';

test('reloads real PMTiles chart data from IndexedDB with archive transport offline', async ({
  page,
  context,
}) => {
  const fixture = await installChartFixture(page);
  await page.goto('./');
  await expectFixtureChart(page);
  await warmFixtureBaseStyle(page);
  const cached = await cachedArchive(page);
  expect(cached.blocks).toEqual(expect.arrayContaining([0, 1]));
  fixture.offline = true;
  fixture.baseOffline = true;
  await context.setOffline(true);
  try {
    // Only chart descriptors remain a live fixture. The base style is served from its runtime
    // cache, and the PMTiles transport is aborted so IndexedDB must supply the actual tile bytes.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectFixtureChart(page);
    expect(await cachedArchive(page)).toEqual(cached);
  } finally {
    await context.setOffline(false);
  }
});

test('serves the application shell after the network goes offline', async ({ context, page }) => {
  const workerProof = await installMapLibreWorkerProof(page);
  await page.goto('./');
  const workerUrl = await workerProof.assertInitialNavigation();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A ready registration does not prove this page is controlled. Reload online once so the active
  // worker takes control, then verify that exact condition before testing its offline responses.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 30_000,
    })
    .toBe(true);

  await context.setOffline(true);
  try {
    const precachedWorker = await page.evaluate(async (url) => {
      const response = await fetch(url, { cache: 'reload' });
      return {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('Content-Type'),
      };
    }, workerUrl);
    expect(precachedWorker.status).toBe(200);
    expect(precachedWorker.ok).toBe(true);
    expect(precachedWorker.contentType).toMatch(/(?:java|ecma)script/i);

    await page.goto('./offline-check', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/signalk-binnacle\/offline-check$/);
    await expect(page).toHaveTitle(/Binnacle/);
    await expect(page.locator('body')).toContainText('Binnacle');
    const precachedAsset = await page.evaluate(async () => {
      const response = await fetch('./binnacle-icon.svg', { cache: 'reload' });
      return { ok: response.ok, contentType: response.headers.get('Content-Type') };
    });
    expect(precachedAsset.ok).toBe(true);
    expect(precachedAsset.contentType).toContain('image/svg+xml');
  } finally {
    await context.setOffline(false);
  }
});
