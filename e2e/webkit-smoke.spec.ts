import { expect, test } from '@playwright/test';
import { installMapLibreWorkerProof } from './maplibre-worker-proof';

test.use({ serviceWorkers: 'block' });

test('WebKit supports the app shell and a primary panel interaction', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const workerProof = await installMapLibreWorkerProof(page);
  await page.goto('/');

  await expect(page.locator('.brand')).toContainText('Binnacle Chartplotter');
  await expect(page.locator('.status-strip .conn')).toHaveAttribute(
    'title',
    /Connecting|Connected|Reconnecting|Not connected/,
  );

  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.locator('#app-menu-launcher');
  const center = menu.getByRole('button', { name: /Center/ });
  await expect(center).toHaveAttribute('title', /GPS position/, { timeout: 15_000 });
  await workerProof.assertInitialNavigation();

  const layers = menu.getByRole('button', { name: 'Layers and charts', exact: true });
  await expect(layers).toBeEnabled({ timeout: 15_000 });
  await layers.click();

  const panel = page.locator('#layers-panel');
  await expect(panel).toBeVisible();
  const overlays = panel.getByRole('button', { name: 'Overlays', exact: true });
  await overlays.click();
  await expect(overlays).toHaveAttribute('aria-pressed', 'true');

  await panel.getByRole('button', { name: 'Close layers and charts' }).click();
  await expect(panel).toHaveCount(0);
});
