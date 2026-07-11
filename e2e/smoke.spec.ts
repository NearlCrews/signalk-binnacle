import { expect, test } from '@playwright/test';

// Smoke tests route selected external APIs. Blocking service workers keeps those requests visible
// to Playwright instead of letting a previously installed worker bypass the route hooks.
test.use({ serviceWorkers: 'block' });

test('app shell renders the brand and a connection status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Binnacle')).toBeVisible();
  await expect(page.getByText(/Connecting|Connected|Reconnecting|Not connected/)).toBeVisible();
  await expect(page.getByText('SOG')).toBeVisible();
});

test('menu prioritizes safety and customizes toolbar order without shifting blocked feedback', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.locator('#app-menu-launcher');
  await expect(menu).toBeVisible();

  const safety = menu.getByRole('group', { name: 'Safety' });
  const weather = menu.getByRole('group', { name: 'Weather' });
  const safetyBox = await safety.boundingBox();
  const weatherBox = await weather.boundingBox();
  if (!safetyBox || !weatherBox) throw new Error('menu groups did not lay out');
  expect(safetyBox.y).toBeLessThan(weatherBox.y);

  await menu.getByRole('button', { name: 'Customize toolbar' }).click();
  await menu.getByRole('button', { name: 'Reset toolbar' }).click();
  await menu
    .getByRole('button', { name: /Move Layers and charts, position 3 of 4/ })
    .press('ArrowUp');

  await expect
    .poll(async () =>
      page
        .locator('footer .strip-center > button')
        .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim())),
    )
    .toEqual(['Center', 'Charts', 'Follow', 'Instruments']);

  await menu.getByRole('button', { name: 'Done' }).click();
  const mapBefore = await menu.getByRole('group', { name: 'Map' }).boundingBox();
  if (!mapBefore) throw new Error('map group did not lay out');
  await menu.getByRole('button', { name: /Radar/ }).click({ force: true });
  await expect(menu.locator('.blocked-note')).toBeVisible();
  const mapAfter = await menu.getByRole('group', { name: 'Map' }).boundingBox();
  if (!mapAfter) throw new Error('map group moved out of layout');
  expect(mapAfter.y).toBe(mapBefore.y);
});

test('layers and charts opens chart sources before overlay stack controls', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  const charts = page.getByRole('button', { name: 'Charts' }).first();
  await expect(charts).toBeEnabled();
  await charts.click();

  const panel = page.locator('#layers-panel');
  await expect(panel).toBeVisible();
  const layerViewTabs = panel.getByLabel('Layers and charts view');
  await expect(layerViewTabs.getByRole('button', { name: 'Charts' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('heading', { name: 'Chart sources' })).toBeVisible();

  await panel.getByRole('button', { name: 'Add a chart' }).click();
  await expect(panel.getByText('Chart files on this server')).toBeVisible();
  await expect(panel.getByText('From a PMTiles URL')).toBeVisible();

  await layerViewTabs.getByRole('button', { name: 'Overlays' }).click();
  await expect(layerViewTabs.getByRole('button', { name: 'Overlays' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
  await dock.getByRole('button', { name: /Open Speed details/ }).click();
  await expect(dock.getByRole('button', { name: 'Back to instruments' })).toBeVisible();
  await expect(dock.getByRole('heading', { name: 'Signal K paths' })).toBeVisible();
  await expect(dock.getByText('navigation.speedOverGround')).toBeVisible();
  await dock.getByRole('button', { name: 'Back to instruments' }).click();
  // Customize flips to the catalog rows and back.
  await dock.getByRole('button', { name: 'Customize instruments' }).click();
  await expect(dock.getByText('Tap an instrument to show or hide', { exact: false })).toBeVisible();
  await expect(dock.getByRole('button', { name: /Rescan|Scanning/ })).toBeVisible();
  await expect(dock.getByRole('heading', { name: 'Navigation' })).toBeVisible();
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

test('weather remains usable without horizontal overflow on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      'binnacle:weather-layers',
      JSON.stringify({ 'weather-wind': { visible: true, opacity: 1 } }),
    );
  });
  let forecastRequests = 0;
  await page.context().route(/api\.open-meteo\.com\/v1\/forecast/, async (route) => {
    forecastRequests += 1;
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') ?? '').split(',').map(Number);
    const lons = (url.searchParams.get('longitude') ?? '').split(',').map(Number);
    const start = Math.floor(Date.now() / 3_600_000) * 3600;
    const time = [start, start + 3600, start + 7200];
    const records = lats.map((latitude, index) => ({
      latitude,
      longitude: lons[index],
      hourly: {
        time,
        wind_speed_10m: [6, 7, 8],
        wind_direction_10m: [225, 230, 235],
        wind_gusts_10m: [9, 10, 11],
        pressure_msl: [1012, 1011, 1010],
        precipitation: [0, 0.4, 0.8],
        cloud_cover: [20, 40, 60],
      },
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(records),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Forecast' }).click();

  const panel = page.locator('#weather-panel');
  await expect(panel).toBeVisible();
  await expect.poll(() => forecastRequests).toBeGreaterThan(0);
  await expect(panel.getByRole('slider')).toBeVisible();
  await expect
    .poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
  await expect
    .poll(() =>
      panel
        .locator('.weather-footer')
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    )
    .toBe(true);

  const mapBox = await panel.locator('.panel-map').boundingBox();
  const controlBox = await panel.locator('.scrubber button').first().boundingBox();
  const timeBox = await panel.locator('.scrubber .time').boundingBox();
  if (!mapBox || !controlBox || !timeBox) throw new Error('weather panel did not lay out');
  expect(mapBox.height).toBeGreaterThan(100);
  expect(timeBox.y).toBeGreaterThanOrEqual(controlBox.y + controlBox.height - 1);
});
