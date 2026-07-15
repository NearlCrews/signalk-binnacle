import { expect, test } from '@playwright/test';

test('serves the application shell after the network goes offline', async ({ context, page }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Binnacle/);
    await expect(page.locator('body')).toContainText('Binnacle');
  } finally {
    await context.setOffline(false);
  }
});
