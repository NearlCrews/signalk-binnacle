import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('WebKit supports the app shell and a primary panel interaction', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  await expect(page.locator('.brand')).toContainText('Binnacle Chartplotter');
  await expect(page.getByText(/Connecting|Connected|Reconnecting|Not connected/)).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  const layers = page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Layers and charts', exact: true });
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
