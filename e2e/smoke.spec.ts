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
  await dock.getByRole('button', { name: 'Customize instruments' }).click();
  await expect(dock.getByText('Tap an instrument to show or hide', { exact: false })).toBeVisible();
  await dock.getByRole('button', { name: 'Done' }).click();
  // Close from the header returns to the chart-only shell.
  await dock.getByRole('button', { name: 'Close instruments dock' }).click();
  await expect(dock).not.toBeVisible();
});

test('a touch drag on a customize grip reorders the shown instruments', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Instruments' }).first().click();
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await dock.getByRole('button', { name: 'Customize instruments' }).click();

  const shownTitles = () =>
    page.$$eval('.tile-list li[data-tile-row] .title', (els) =>
      els.map((e) => e.textContent?.trim()),
    );
  const before = await shownTitles();
  expect(before[0]).toBe('Speed');

  // Drive a real touch drag through CDP so the browser's touch-action arbitration applies: the grip
  // must set touch-action: none or the gesture is claimed as a scroll and never reorders.
  const grip = dock.locator('.tile-list .handle').first();
  const box = await grip.boundingBox();
  if (!box) throw new Error('no grip');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const tp = (y: number) => [{ x: cx, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(cy) });
  for (const dy of [20, 60, 110]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(cy + dy) });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect.poll(async () => (await shownTitles())[0]).not.toBe('Speed');
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
