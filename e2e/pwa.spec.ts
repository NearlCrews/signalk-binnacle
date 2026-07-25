import { expect, test } from '@playwright/test';

test('serves the application shell after the network goes offline', async ({ context, page }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A ready registration does not prove this page is controlled. Reload online once so the active
  // worker takes control, then verify that exact condition before testing its offline responses.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  try {
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
