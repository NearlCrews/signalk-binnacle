import { expect, test } from '@playwright/test';

test('app shell renders the brand and a connection status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Binnacle')).toBeVisible();
  await expect(page.getByText(/Connecting|Connected|Reconnecting|Not connected/)).toBeVisible();
  await expect(page.getByText('SOG')).toBeVisible();
});

test('instrument dock opens beside a still-present chart and closes from its header', async ({
  page,
}) => {
  await page.goto('/');
  // The Instruments pill is default-pinned on the bottom bar for a fresh profile.
  await page.getByRole('button', { name: 'Instruments' }).first().click();
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await expect(dock).toBeVisible();
  // The chart host stays in the layout beside the dock (true split, not an overlay).
  await expect(page.getByRole('region', { name: 'Chart' })).toBeVisible();
  // Default tiles render their plain labels.
  await expect(dock.getByText('Speed', { exact: false }).first()).toBeVisible();
  // Customize flips to the catalog rows and back.
  await dock.getByRole('button', { name: 'Customize' }).click();
  await expect(
    dock.getByText('Tap an instrument to show or hide it on the dock', { exact: false }),
  ).toBeVisible();
  await dock.getByRole('button', { name: 'Done' }).click();
  // Close from the header returns to the chart-only shell.
  await dock.getByRole('button', { name: 'Close instruments dock' }).click();
  await expect(dock).not.toBeVisible();
});

test('instrument tiles take the full screen under the breakpoint with their own close chrome', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Instruments' }).first().click();
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await expect(dock).toBeVisible();
  // Full-screen mode swaps the close label; this chrome is the only way back on a phone.
  await dock.getByRole('button', { name: 'Close instruments, return to chart' }).click();
  await expect(dock).not.toBeVisible();
});
