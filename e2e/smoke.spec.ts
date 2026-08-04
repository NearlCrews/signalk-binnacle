import { expect, type Page, test } from '@playwright/test';
import { installMapLibreWorkerProof } from './maplibre-worker-proof';

// Smoke tests route selected external APIs. Blocking service workers keeps those requests visible
// to Playwright instead of letting a previously installed worker bypass the route hooks.
test.use({ serviceWorkers: 'block' });

async function openInstruments(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Instruments', exact: true })
    .click();
}

async function openTrends(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Data trends', exact: true })
    .click();
}

async function openTimeTravel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Time travel', exact: true })
    .click();
}

async function mockChartLocker(page: Page, regions: unknown[] = []): Promise<void> {
  await page.route(/\/plugins\/signalk-chart-locker\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/tiles/ready')) {
      await route.fulfill({ status: 200, body: 'ready' });
      return;
    }
    if (path.endsWith('/style/basemap')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      });
      return;
    }
    if (path.endsWith('/api/cache/stats')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rows: 0,
          bytes: 0,
          cap: 1_000_000_000,
          regionsFreeBytes: 500_000_000,
          perSourceAvgBytes: { seamark: 565.7692307692307 },
        }),
      });
      return;
    }
    if (path.endsWith('/api/regions')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(regions),
      });
      return;
    }
    if (path.endsWith('/api/position-warm/config')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({ status: 404, body: 'not found' });
  });
}

test('app shell renders the brand and a connection status', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.brand')).toContainText('Binnacle Chartplotter');
  await expect(page.locator('.status-strip .conn')).toHaveAttribute(
    'title',
    /Connecting|Connected|Reconnecting|Not connected/,
  );
  await expect(page.getByText('SOG')).toBeVisible();
});

test('app shell stays usable and explains when WebGL2 is unavailable', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      ...args: unknown[]
    ) {
      if (contextId === 'webgl2') return null;
      return Reflect.apply(getContext, this, [contextId, ...args]);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto('/');
  await expect(page.locator('.chart-start-error')).toContainText('WebGL2');
  await expect(page.locator('.brand')).toContainText('Binnacle Chartplotter');
  await expect(page.getByText('SOG')).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('#app-menu-launcher')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('time travel changes bounded ranges, replays history, and retains accepted data', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/_providers$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ 'signalk-questdb': { isDefault: true } }),
    }),
  );
  const requests: Array<{ duration: string | null; resolution: string | null }> = [];
  await page.route(/\/signalk\/v2\/api\/history\/values/, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const duration = params.get('duration');
    const resolution = params.get('resolution');
    requests.push({ duration, resolution });
    if (duration === '21600') {
      await route.fulfill({ status: 500, body: 'range unavailable' });
      return;
    }
    const durationSeconds = Number(duration);
    const toMs = Date.UTC(2026, 6, 28, 12);
    const fromMs = toMs - durationSeconds * 1000;
    const columns = (params.get('paths') ?? '')
      .split(',')
      .filter(Boolean)
      .map((requestPath) => {
        const aggregateAt = requestPath.lastIndexOf(':');
        return aggregateAt > 0
          ? {
              path: requestPath.slice(0, aggregateAt),
              method: requestPath.slice(aggregateAt + 1),
            }
          : { path: requestPath, method: 'average' };
      });
    const row = (timeMs: number, offset: number) => [
      new Date(timeMs).toISOString(),
      ...columns.map((column) =>
        column.path === 'navigation.position'
          ? { longitude: -82.7 + offset * 0.01, latitude: 27.7 + offset * 0.01 }
          : offset + 1,
      ),
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        range: {
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
        },
        values: columns,
        data: [row(fromMs, 0), row((fromMs + toMs) / 2, 1), row(toMs, 2)],
      }),
    });
  });

  await page.goto('/');
  await openTimeTravel(page);
  const strip = page.getByRole('complementary', { name: 'Time travel' });
  await expect(strip).toBeVisible();
  await expect.poll(() => requests.at(-1)).toEqual({ duration: '86400', resolution: '60' });
  await expect(strip.getByText('Source: signalk-questdb. 24 hours loaded.')).toBeVisible();
  await expect(strip.getByText('2026', { exact: false }).first()).toBeVisible();

  await strip.getByRole('button', { name: '7 d', exact: true }).click();
  await expect.poll(() => requests.at(-1)).toEqual({ duration: '604800', resolution: '300' });
  await expect(strip.getByText('Source: signalk-questdb. 7 days loaded.')).toBeVisible();

  await strip.getByRole('button', { name: 'Play history' }).click();
  await expect(strip.getByRole('button', { name: 'Pause history playback' })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(strip.getByRole('button', { name: 'Play history' })).toBeVisible();

  await strip.getByRole('button', { name: '6 h', exact: true }).click();
  await expect.poll(() => requests.at(-1)).toEqual({ duration: '21600', resolution: '15' });
  await expect(strip.getByRole('alert')).toContainText('Could not load 6 hours. Showing 7 days.');
  await expect(strip.getByText('Source: signalk-questdb. 7 days loaded.')).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(
    strip.getByText('Automatic playback is off because reduced motion is enabled.'),
  ).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Play history' })).toBeDisabled();

  const rangeButton = strip.getByRole('button', { name: '24 h', exact: true });
  const rangeBox = await rangeButton.boundingBox();
  if (!rangeBox) throw new Error('time travel range button did not lay out');
  expect(rangeBox.height).toBeGreaterThanOrEqual(44);
  expect(await strip.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('time travel can exit while its lazy controls are still loading', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/_providers$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ 'signalk-questdb': { isDefault: true } }),
    }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/values/, (route) =>
    route.fulfill({ status: 500, body: 'history unavailable' }),
  );
  let releaseChunk = () => {};
  const chunkGate = new Promise<void>((resolve) => {
    releaseChunk = resolve;
  });
  await page.route(/\/assets\/HistoryStrip-[^/]+\.js$/, async (route) => {
    await chunkGate;
    await route.continue();
  });

  try {
    await page.goto('/');
    await openTimeTravel(page);
    const pending = page
      .locator('.bottom-strip')
      .filter({ hasText: 'Loading time travel controls' });
    await expect(pending).toBeVisible();
    await pending.getByRole('button', { name: 'Exit' }).click();
    await expect(pending).not.toBeVisible();

    await openTimeTravel(page);
    await expect(pending).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pending).not.toBeVisible();
  } finally {
    releaseChunk();
  }
});

test('weather can exit while its lazy view is still loading', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  let releaseChunk = () => {};
  const chunkGate = new Promise<void>((resolve) => {
    releaseChunk = resolve;
  });
  await page.route(/\/assets\/WeatherMap-[^/]+\.js$/, async (route) => {
    await chunkGate;
    await route.continue();
  });

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const forecast = page
      .locator('#app-menu-launcher')
      .getByRole('button', { name: 'Forecast', exact: true });
    await forecast.click();

    const pending = page.locator('.panel-loading--cover');
    await expect(pending.getByText('Loading weather view…', { exact: true })).toBeVisible();
    await pending.getByRole('button', { name: 'Back to menu' }).click();
    await expect(pending).not.toBeVisible();

    await expect(forecast).toBeVisible();
    await forecast.click();
    await expect(pending.getByText('Loading weather view…', { exact: true })).toBeVisible();
    await pending.getByRole('button', { name: 'Close' }).click();
    await expect(pending).not.toBeVisible();

    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await forecast.click();
    await expect(pending.getByText('Loading weather view…', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pending).not.toBeVisible();
  } finally {
    releaseChunk();
  }
});

test('center and follow explain when no GPS fix is available', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const workerProof = await installMapLibreWorkerProof(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.locator('#app-menu-launcher');
  const center = menu.getByRole('button', { name: /Center/ });
  const follow = menu.getByRole('button', { name: /Follow/ });
  await expect(center).toHaveAttribute('aria-disabled', 'true');
  await expect(follow).toHaveAttribute('aria-disabled', 'true');
  // MapLibre can take longer than the default assertion window to finish on the Pi. Wait for the
  // chart-loading gate to resolve before checking the distinct no-position explanation.
  await expect(center).toHaveAttribute('title', /GPS position/, { timeout: 15_000 });
  await workerProof.assertInitialNavigation();
  await center.click({ force: true });
  await expect(menu.locator('.blocked-note')).toContainText('GPS position');
});

test('menu prioritizes safety and customizes toolbar order without shifting blocked feedback', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
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

test('radar discovery opens a hydrated provider-driven controls panel', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => localStorage.clear());
  const radarWrites: Array<{ pathname: string; body: unknown }> = [];
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(/\/signalk\/v2\/features/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apis: ['radar'], plugins: [] }),
    });
  });
  await page.route(/\/signalk\/v2\/api\/vessels\/self\/radars/, async (route) => {
    const url = route.request().url();
    const requestBody = route.request().postDataJSON() as
      | { value?: Record<string, unknown> }
      | undefined;
    if (route.request().method() === 'PUT') {
      radarWrites.push({ pathname: new URL(url).pathname, body: requestBody });
      await route.fulfill({ status: 200, body: '' });
      return;
    }
    if (url.endsWith('/capabilities')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          controls: {
            gain: {
              name: 'Gain',
              description: 'Receiver sensitivity',
              dataType: 'number',
              minValue: 0,
              maxValue: 100,
              stepValue: 1,
              hasAuto: true,
            },
            guardZone1: {
              name: 'Guard zone 1',
              description: 'Heading-relative target detection area',
              dataType: 'zone',
              minValue: -Math.PI,
              maxValue: Math.PI,
              stepValue: Math.PI / 180,
              units: 'rad',
              maxDistance: 100_000,
              hasEnabled: true,
            },
            noTransmitSector1: {
              name: 'No-transmit sector 1',
              description: 'Heading-relative radar emission exclusion',
              dataType: 'sector',
              minValue: -Math.PI,
              maxValue: Math.PI,
              stepValue: Math.PI / 180,
              units: 'rad',
              hasEnabled: true,
            },
            exclusionRect1: {
              name: 'Exclusion rectangle 1',
              description: 'Stationary target exclusion area',
              dataType: 'rect',
              minValue: 0,
              maxValue: 100_000,
              units: 'm',
              maxDistance: 100_000,
              hasEnabled: true,
            },
          },
        }),
      });
      return;
    }
    if (url.endsWith('/controls')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          gain: { value: 42, auto: false },
          power: { value: 'standby' },
          guardZone1: {
            value: -Math.PI / 2,
            endValue: Math.PI / 2,
            startDistance: 200,
            endDistance: 500,
            enabled: false,
            allowed: true,
          },
          noTransmitSector1: {
            value: -Math.PI / 3,
            endValue: Math.PI / 3,
            enabled: false,
            allowed: true,
          },
          exclusionRect1: {
            x1: -100,
            y1: 50,
            x2: 100,
            y2: 50,
            width: 20,
            enabled: true,
            allowed: true,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'halo',
          name: 'Cabin Halo',
          brand: 'Navico',
          status: 'standby',
          spokesPerRevolution: 2048,
          maxSpokeLen: 1024,
          range: 1852,
          controls: {
            gain: { value: 40, auto: false },
            power: { value: 'standby' },
            guardZone1: {
              value: -Math.PI / 2,
              endValue: Math.PI / 2,
              startDistance: 200,
              endDistance: 500,
              enabled: false,
              allowed: true,
            },
            noTransmitSector1: {
              value: -Math.PI / 3,
              endValue: Math.PI / 3,
              enabled: false,
              allowed: true,
            },
            exclusionRect1: {
              x1: -100,
              y1: 50,
              x2: 100,
              y2: 50,
              width: 20,
              enabled: true,
              allowed: true,
            },
          },
        },
        {
          id: 'halo-b',
          name: 'Flybridge Halo',
          brand: 'Navico',
          status: 'standby',
          spokesPerRevolution: 2048,
          maxSpokeLen: 1024,
          range: 1852,
          controls: {
            gain: { value: 38, auto: false },
            power: { value: 'standby' },
            guardZone1: {
              value: -Math.PI / 3,
              endValue: Math.PI / 3,
              startDistance: 150,
              endDistance: 450,
              enabled: false,
              allowed: true,
            },
          },
        },
      ]),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const radar = page.getByRole('button', { name: /Radar$/ });
  await expect(radar).toBeEnabled({ timeout: 10_000 });
  await radar.click();

  const panel = page.getByRole('complementary', { name: 'Radar controls' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Cabin Halo · Navico')).toBeVisible();
  await expect(panel.locator('.power-status')).toHaveText('Standby');
  await expect(panel.getByText('42', { exact: true })).toBeVisible();
  await expect(panel.getByRole('slider', { name: 'Gain' })).toHaveValue('42');
  await panel.getByRole('button', { name: 'Advanced controls' }).click();
  await expect(panel.getByText(/Zone disabled/)).toBeVisible();
  await panel.getByRole('button', { name: 'Edit guard zone' }).click();
  await panel.getByRole('spinbutton', { name: 'Start angle' }).fill('-45');
  await panel.getByRole('spinbutton', { name: `Inner distance in m` }).fill('250');
  await panel.getByRole('spinbutton', { name: `Outer distance in m` }).fill('750');
  await panel.getByRole('button', { name: 'Save zone' }).click();
  await expect.poll(() => radarWrites).toHaveLength(1);
  expect(radarWrites[0]).toEqual({
    pathname: '/signalk/v2/api/vessels/self/radars/halo',
    body: {
      value: {
        guardZone1: {
          value: -Math.PI / 4,
          endValue: Math.PI / 2,
          startDistance: 250,
          endDistance: 750,
          enabled: false,
        },
      },
    },
  });
  await panel.getByRole('button', { name: 'Edit no-transmit sector' }).click();
  await panel.getByRole('spinbutton', { name: 'Start angle' }).fill('-30');
  await panel.getByRole('button', { name: 'Save sector' }).click();
  const sectorConfirm = panel.getByRole('group', {
    name: 'Apply this no-transmit sector and change the radar emission envelope?',
  });
  await expect(sectorConfirm).toBeVisible();
  await sectorConfirm.getByRole('button', { name: 'Apply sector' }).click();
  await expect.poll(() => radarWrites).toHaveLength(2);
  expect(radarWrites[1]).toEqual({
    pathname: '/signalk/v2/api/vessels/self/radars/halo',
    body: {
      value: {
        noTransmitSector1: {
          value: -Math.PI / 6,
          endValue: Math.PI / 3,
          enabled: false,
        },
      },
    },
  });
  await panel.getByRole('button', { name: 'Edit exclusion rectangle' }).click();
  await panel.getByRole('spinbutton', { name: 'Width' }).fill('40');
  await panel.getByRole('button', { name: 'Save rectangle' }).click();
  await expect.poll(() => radarWrites).toHaveLength(3);
  expect(radarWrites[2]).toEqual({
    pathname: '/signalk/v2/api/vessels/self/radars/halo',
    body: {
      value: {
        exclusionRect1: {
          x1: -100,
          y1: 50,
          x2: 100,
          y2: 50,
          width: 40,
          enabled: true,
        },
      },
    },
  });
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(320);
  await panel.getByRole('button', { name: 'Transmit', exact: true }).click();
  const transmitConfirm = panel.getByRole('group', { name: 'Start transmitting radar energy?' });
  await expect(transmitConfirm).toBeVisible();
  await transmitConfirm.getByRole('button', { name: 'Cancel' }).click();
  await panel.getByRole('button', { name: 'Edit guard zone' }).click();
  const endAngle = panel.getByRole('spinbutton', { name: 'End angle' });
  await endAngle.fill('60');
  await endAngle.press('Tab');
  const radarSelector = panel.getByRole('combobox', { name: 'Select radar' });
  await radarSelector.selectOption('halo-b');
  const discardConfirm = panel.getByRole('group', {
    name: 'Discard unsaved radar-area changes?',
  });
  await expect(discardConfirm).toBeVisible();
  await expect(radarSelector).toHaveValue('halo');
  await discardConfirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(radarSelector).toHaveValue('halo');
  await expect(panel.getByText('Cabin Halo · Navico')).toBeVisible();

  await panel.getByRole('button', { name: 'Minimize panel' }).click();
  await expect(panel.locator('.panel-body')).toHaveClass(/panel-body--collapsed/);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: /Radar$/ })
    .click();
  await expect(panel.locator('.panel-body')).not.toHaveClass(/panel-body--collapsed/);
  await expect(discardConfirm).toBeVisible();
  await discardConfirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toBeVisible();

  await panel.getByRole('button', { name: 'Advanced controls' }).click();
  await panel.getByRole('button', { name: 'Open overlay settings' }).click();
  await expect(discardConfirm).toBeVisible();
  await discardConfirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Open overlay settings' }).click();
  await discardConfirm.getByRole('button', { name: 'Discard' }).click();
  const layers = page.locator('#layers-panel');
  await expect(layers.getByRole('button', { name: 'Overlays', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: /Radar$/ })
    .click();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Advanced controls' }).click();
  await panel.getByRole('button', { name: 'Edit guard zone' }).click();
  await panel.getByRole('spinbutton', { name: 'End angle' }).fill('45');

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Instruments', exact: true })
    .click();
  await expect(discardConfirm).toBeVisible();
  await discardConfirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Instruments' })).not.toBeVisible();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Instruments', exact: true })
    .click();
  await expect(discardConfirm).toBeVisible();
  await discardConfirm.getByRole('button', { name: 'Discard' }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Instruments' })).toBeVisible();
});

test('offline charts stays discoverable when Chart Locker is not installed', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();

  const menu = page.locator('#app-menu-launcher');
  const offline = menu.getByRole('button', { name: /Offline charts/ });
  await expect(offline).toBeVisible();
  await expect(offline).toHaveAttribute('aria-disabled', 'true');
  await offline.click({ force: true });
  await expect(menu.locator('.blocked-note')).toContainText('signalk-chart-locker');
});

test('offline area review shows a planning estimate and catalog chart defaults', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear());
  await mockChartLocker(page);

  await page.goto('/');
  await expect(page.getByTitle('Offline charts: online, cache 0 B')).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const offline = page.locator('#app-menu-launcher').getByRole('button', {
    name: 'Offline charts',
    exact: true,
  });
  await expect(offline).toBeEnabled({ timeout: 10_000 });
  await offline.click();

  const panel = page.locator('aside.slide-over');
  await panel.getByRole('button', { name: 'Save a chart area' }).click();
  await panel.getByRole('button', { name: 'Draw on the chart' }).click();

  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('map canvas did not lay out');
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.62, { steps: 6 });
  await page.mouse.up();

  await expect(panel.getByText('Area set. Draw again to change it.')).toBeVisible();
  await expect(panel.getByText('Estimated download')).toBeVisible();
  await expect(panel.getByText('Maximum download')).toHaveCount(0);
  await expect(
    panel.getByText('Could not calculate the download estimate.', { exact: false }),
  ).toHaveCount(0);
  await panel.getByRole('button', { name: 'Customize included charts' }).click();
  await expect(panel.getByRole('checkbox', { name: 'EMODnet bathymetry' })).toBeChecked();
  await expect(panel.getByRole('checkbox', { name: 'NOAA ENC' })).toHaveCount(0);
});

test('offline areas explain removed chart sources before re-download', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await mockChartLocker(page, [
    {
      id: 'region-1',
      name: 'Passage',
      bbox: [-71.2, 42.2, -70.8, 42.5],
      sourceIds: ['basemap', 'retired-chart'],
      unavailableSourceIds: ['retired-chart'],
      minzoom: 6,
      maxzoom: 12,
      createdAt: 1,
      lastDownloadedAt: 1,
      bytes: 2048,
      cachedBytes: 2048,
      status: 'ready',
    },
  ]);

  await page.goto('/');
  await expect(page.getByTitle('Offline charts: online, cache 0 B')).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Offline charts', exact: true })
    .click();

  const panel = page.locator('aside.slide-over');
  await expect(
    panel.getByText('One included chart is no longer available from Chart Locker.'),
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Download this area again' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Area details' }).click();
  await expect(panel.getByText('retired-chart (unavailable)')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Adjust a copy' })).toBeEnabled();
});

test('layers and charts opens chart sources before overlay stack controls', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  const charts = page.getByRole('button', { name: 'Charts' }).first();
  await expect(charts).toBeEnabled({ timeout: 15_000 });
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

test('style-document charts stay visible and explain that they are unsupported', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear());
  let styleRequests = 0;
  await page.route(/\/signalk\/v2\/api\/resources\/charts\/?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        'provider-style': {
          identifier: 'provider-style',
          name: 'Provider style',
          description: 'Provider-supplied style document',
          type: 'mapstyleJSON',
          url: '/provider-style.json?access_token=secret',
        },
      }),
    }),
  );
  await page.route(/\/provider-style\.json/, (route) => {
    styleRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Layers and charts', exact: true })
    .click();

  const panel = page.locator('#layers-panel');
  const row = panel.locator('[data-layer-row="chart-provider-style"]');
  await expect(row).toBeVisible();
  await expect(row.getByRole('checkbox', { name: 'Provider style' })).toBeDisabled();
  await expect(row.getByRole('checkbox', { name: 'Provider style' })).not.toBeChecked();
  await row.getByRole('button', { name: 'Open Provider style chart details' }).click();

  await expect(panel.getByText('cannot display it yet')).toBeVisible();
  await expect(panel.getByText('Style', { exact: true })).toBeVisible();
  await expect(panel.getByText('access_token=REDACTED')).toBeVisible();
  await expect(panel.getByText('access_token=secret')).toHaveCount(0);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  expect(styleRequests).toBe(0);
});

test('saved PMTiles charts expose repair, refresh, and sharing controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/\/test-chart\.pmtiles(?:\?|$)/, async (route) => {
    await route.fulfill({ status: 404, body: 'not found' });
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      'binnacle:user-charts',
      JSON.stringify([
        {
          id: 'repair-test-chart',
          name: 'Repair test chart',
          kind: 'vector',
          origin: {
            type: 'url',
            url: `${window.location.origin}/test-chart.pmtiles?access_token=secret`,
          },
          shareWithServer: false,
          bounds: [-84, 41, -82, 43],
          minzoom: 2,
          maxzoom: 12,
          layers: ['water'],
        },
      ]),
    );
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const charts = page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Layers and charts', exact: true });
  await expect(charts).toBeEnabled({ timeout: 15_000 });
  await charts.click();

  const panel = page.locator('#layers-panel');
  await panel.getByRole('button', { name: 'Open Repair test chart chart details' }).click();
  await expect(panel.getByRole('heading', { name: 'Source maintenance' })).toBeVisible();
  await expect(panel.getByText('access_token=REDACTED')).toBeVisible();
  await expect(panel.getByText('access_token=secret')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Replace source URL' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Refresh metadata' })).toBeEnabled();
  await expect(panel.getByText('Share the full chart URL with the Signal K server')).toBeVisible();

  await panel.getByRole('button', { name: 'Refresh metadata' }).click();
  await expect(panel.getByRole('alert')).toContainText('Could not read chart metadata.');
  await expect(panel.getByRole('button', { name: 'Replace source URL' })).toBeEnabled();

  await panel.getByRole('button', { name: 'Replace source URL' }).click();
  await expect(panel.getByRole('textbox', { name: 'Replacement URL' })).toBeFocused();
  await expect(panel.getByText('current URL remains active')).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel.getByRole('button', { name: 'Refresh metadata' })).toBeVisible();
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('route editing confirms before discarding plotted changes', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Routes' }).click();

  const panel = page.getByRole('complementary', { name: 'Routes' });
  await panel.getByRole('button', { name: 'New route' }).click();
  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('map canvas did not lay out');
  await page.waitForTimeout(500);
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.55);
  await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

  await panel.getByRole('button', { name: 'Close routes panel' }).click();
  const discard = panel.getByRole('group', { name: 'Discard unsaved route changes?' });
  await expect(discard).toBeVisible();
  await expect(discard.getByRole('button', { name: 'Discard' })).toBeVisible();
  await discard.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toBeVisible();
});

test('saved route secondary actions use a labeled overflow menu', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  let routeRequests = 0;
  await page.route(/\/signalk\/v2\/api\/resources\/routes$/, async (route) => {
    routeRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        passage: {
          name: 'Harbor passage',
          feature: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-83.5, 42.6],
                [-83.4, 42.7],
              ],
            },
            properties: {},
          },
        },
      }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Routes' }).click();

  const panel = page.getByRole('complementary', { name: 'Routes' });
  await expect.poll(() => routeRequests).toBeGreaterThan(0);
  await expect(panel.getByText('Harbor passage')).toBeVisible();
  await panel.getByRole('button', { name: 'More actions for Harbor passage' }).click();
  const actions = page.getByRole('menu', { name: 'More actions for Harbor passage' });
  await expect(actions.getByRole('menuitem', { name: 'Edit route' })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: 'Save reversed copy' })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: 'Download GPX' })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: 'Delete route' })).toBeVisible();
});

test('instrument dock opens beside a still-present chart and closes from its header', async ({
  page,
}) => {
  await page.goto('/');
  await openInstruments(page);
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await expect(dock).toBeVisible();
  // The chart host stays in the layout beside the dock (true split, not an overlay).
  await expect(page.getByRole('region', { name: 'Chart' })).toBeVisible();
  // Default tiles render their plain labels.
  await expect(dock.getByText('Speed', { exact: false }).first()).toBeVisible();
  await dock.getByRole('button', { name: /Speed.*Open details/ }).click();
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

test('data trends discovers instruments independently and enforces the profile selection limit', async ({
  page,
}) => {
  let providerRequests = 0;
  let batteryRequests = 0;
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/_providers$/, async (route) => {
    providerRequests += 1;
    if (providerRequests === 1) {
      await route.fulfill({ status: 500, body: 'provider probe failed' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(/\/signalk\/v1\/api\/vessels\/self\/electrical\/batteries$/, async (route) => {
    batteryRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        house: {
          voltage: { value: 12.7 },
          current: { value: -4.2 },
          capacity: {
            stateOfCharge: { value: 0.8 },
            timeRemaining: { value: 7200 },
          },
        },
      }),
    });
  });
  await page.route(
    /\/signalk\/v1\/api\/vessels\/self\/(?:propulsion|tanks|electrical\/solar|environment\/inside)$/,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  await page.goto('/');
  await openTrends(page);
  const panel = page.locator('.slide-over[aria-label="Data trends"]');
  await expect(panel).toBeVisible();
  await expect.poll(() => providerRequests, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(panel.getByRole('button', { name: 'Retry provider check' })).toBeVisible();
  await panel.getByRole('button', { name: 'Retry provider check' }).click();
  await expect(panel.getByText('This session only.', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Customize trends' }).click();

  await expect.poll(() => batteryRequests).toBeGreaterThan(0);
  await expect(panel.getByRole('checkbox', { name: 'Voltage · House battery' })).toBeVisible();
  await expect(panel.getByText('4 of 8 selected')).toBeVisible();
  for (const label of ['Water speed', 'True wind', 'Water temp', 'Air temp']) {
    await panel.getByRole('checkbox', { name: label, exact: true }).check();
  }

  await expect(panel.getByText('8 of 8 selected')).toBeVisible();
  const ninth = panel.getByRole('checkbox', { name: 'Satellites', exact: true });
  await expect(ninth).toBeVisible();
  await expect(ninth).toBeDisabled();
  await expect(panel.getByText('Remove a trend before adding another.').first()).toBeVisible();

  const selectedTitles = () =>
    panel.locator('.trend-list').first().locator('[data-trend-row] .title').allTextContents();
  await expect.poll(async () => (await selectedTitles())[0]?.trim()).toBe('Depth');
  await panel.getByRole('button', { name: /Move Depth, position 1 of 8/ }).press('ArrowDown');
  await expect.poll(async () => (await selectedTitles())[0]?.trim()).not.toBe('Depth');

  const grip = panel.locator('.trend-list').first().locator('.handle').first();
  const box = await grip.boundingBox();
  if (!box) throw new Error('Trend move handle did not lay out.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const point = (offset: number) => [{ x, y: y + offset, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0) });
  for (const offset of [20, 60, 110]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(offset) });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await selectedTitles())[0]?.trim()).not.toBe('Wind');
});

test('history-only engine readings stay identifiable through selection and detail', async ({
  page,
}) => {
  let pathRequests = 0;
  let valueRequests = 0;
  const historyWindowSeconds = 365 * 24 * 60 * 60;
  const historyPaths = [
    'propulsion.port.engineLoad',
    'propulsion.port.revolutions',
    'propulsion.port.temperature',
  ];
  const recordedValues = new Map([
    ['propulsion.port.engineLoad', 0.4],
    ['propulsion.port.revolutions', 20],
    ['propulsion.port.temperature', 350],
  ]);
  let pathQuery: { duration: string | null; provider: string | null } | undefined;
  let valueQuery:
    | {
        paths: string[];
        duration: string | null;
        resolution: string | null;
        provider: string | null;
      }
    | undefined;
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/_providers$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ 'signalk-questdb': { isDefault: true } }),
    }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/paths/, async (route) => {
    pathRequests += 1;
    const params = new URL(route.request().url()).searchParams;
    pathQuery = { duration: params.get('duration'), provider: params.get('provider') };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(historyPaths),
    });
  });
  await page.route(/\/signalk\/v2\/api\/history\/values/, async (route) => {
    valueRequests += 1;
    const params = new URL(route.request().url()).searchParams;
    const requestedPaths = (params.get('paths') ?? '').split(',').filter(Boolean);
    const columns = requestedPaths.map((requestPath) => {
      const aggregateAt = requestPath.lastIndexOf(':');
      return aggregateAt > 0
        ? {
            path: requestPath.slice(0, aggregateAt),
            method: requestPath.slice(aggregateAt + 1),
          }
        : { path: requestPath, method: 'average' };
    });
    valueQuery = {
      paths: requestedPaths,
      duration: params.get('duration'),
      resolution: params.get('resolution'),
      provider: params.get('provider'),
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        range: {
          from: '2026-07-01T00:00:00Z',
          to: '2026-07-01T00:01:00Z',
        },
        values: columns,
        data: [
          [
            '2026-07-01T00:00:00Z',
            ...columns.map((column) => recordedValues.get(column.path) ?? null),
          ],
        ],
      }),
    });
  });

  await page.goto('/');
  await openInstruments(page);
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await dock.getByRole('button', { name: 'Customize instruments' }).click();
  await expect.poll(() => pathRequests).toBeGreaterThan(0);
  await expect.poll(() => valueRequests).toBeGreaterThan(0);
  expect(pathQuery).toEqual({
    duration: String(historyWindowSeconds),
    provider: 'signalk-questdb',
  });
  expect(valueQuery).toEqual({
    paths: historyPaths,
    duration: String(historyWindowSeconds),
    resolution: String(historyWindowSeconds),
    provider: 'signalk-questdb',
  });
  const portEngine = dock.getByRole('checkbox', { name: 'RPM · Port engine' });
  await expect(dock.getByRole('checkbox', { name: 'Temperature · Port engine' })).toBeVisible();
  await expect(dock.getByRole('checkbox', { name: 'Load · Port engine' })).toBeVisible();
  await expect(portEngine).toHaveAttribute(
    'aria-describedby',
    'instrument-history-prop-rpm%3Aport',
    { timeout: 15_000 },
  );
  const rpmHistoryNote = dock.locator('[id="instrument-history-prop-rpm%3Aport"]');
  await expect(rpmHistoryNote).toHaveText('Previously seen, no live data');
  await portEngine.check();
  await expect(rpmHistoryNote).toHaveText('Previously seen, no live data');
  await dock.getByRole('button', { name: 'Done' }).click();
  await dock.getByRole('button', { name: /RPM · Port engine.*Open details/ }).click();
  await expect(dock.getByText('Previously recorded, but not reporting live now.')).toBeVisible();
  await dock.getByRole('button', { name: 'View recent trend' }).click();
  const trends = page.locator('.slide-over[aria-label="Data trends"]');
  await expect(
    trends.getByRole('heading', { name: 'RPM · Port engine', exact: true }),
  ).toBeVisible();
  await expect(trends.getByText(/Last 24 hours · signalk-questdb/)).toBeVisible();
});

test('focused trends return to instrument detail without changing the saved overview', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v2\/api\/history\/_providers$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  await page.goto('/');
  await openInstruments(page);
  let dock = page.getByRole('complementary', { name: 'Instruments' });
  await dock.getByRole('button', { name: 'Customize instruments' }).click();
  await dock.getByRole('checkbox', { name: 'Water speed', exact: true }).check();
  await dock.getByRole('button', { name: 'Done' }).click();
  await dock.getByRole('button', { name: /Water speed.*Open details/ }).click();
  const trendAction = dock.getByRole('button', { name: 'View recent trend' });
  await trendAction.click();

  let trends = page.locator('.slide-over[aria-label="Data trends"]');
  await expect(trends.getByRole('heading', { name: 'Water speed', exact: true })).toBeVisible();
  await expect(
    trends.getByText('Focused session started when this trend opened. No samples yet.'),
  ).toBeVisible();
  await trends.getByRole('button', { name: 'Back to instrument details' }).click();

  dock = page.getByRole('complementary', { name: 'Instruments' });
  const restoredAction = dock.getByRole('button', { name: 'View recent trend' });
  await expect(restoredAction).toBeVisible();
  await expect(restoredAction).toBeFocused();
  await restoredAction.click();
  trends = page.locator('.slide-over[aria-label="Data trends"]');
  await trends.getByRole('button', { name: 'Close trends, return to chart' }).click();
  await expect(trends).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Chart' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Instruments' })).not.toBeVisible();

  await openTrends(page);
  const overview = page.locator('.slide-over[aria-label="Data trends"]');
  await overview.getByRole('button', { name: 'Customize trends' }).click();
  await expect(overview.getByText('4 of 8 selected')).toBeVisible();
  await expect(
    overview.getByRole('checkbox', { name: 'Water speed', exact: true }),
  ).not.toBeChecked();
});

test('trend charts stay scrub-accessible and night-readable on a 320 px phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.clear());
  let historyValueRequests = 0;
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/_providers$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ 'signalk-questdb': { isDefault: true } }),
    }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/paths/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/values/, async (route) => {
    historyValueRequests += 1;
    const params = new URL(route.request().url()).searchParams;
    const columns = (params.get('paths') ?? '')
      .split(',')
      .filter(Boolean)
      .map((requestPath) => {
        const aggregateAt = requestPath.lastIndexOf(':');
        return {
          path: requestPath.slice(0, aggregateAt),
          method: requestPath.slice(aggregateAt + 1),
        };
      });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        range: {
          from: '2026-07-28T00:00:00Z',
          to: '2026-07-28T00:05:00Z',
        },
        values: columns,
        data: [
          ['2026-07-28T00:00:00Z', ...columns.map(() => 2)],
          ['2026-07-28T00:05:00Z', ...columns.map(() => 4)],
        ],
      }),
    });
  });

  await page.goto('/');
  await openTrends(page);
  const panel = page.locator('.slide-over[aria-label="Data trends"]');
  const scrubber = panel.getByRole('slider', { name: 'Inspect Depth timeline' });
  await expect.poll(() => historyValueRequests, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(scrubber).toBeVisible({ timeout: 10_000 });
  await expect(panel).toHaveAttribute('role', 'dialog');
  await expect(panel).toHaveAttribute('aria-modal', 'true');
  const scrubberBox = await scrubber.boundingBox();
  expect(scrubberBox?.height).toBeGreaterThanOrEqual(44);
  await scrubber.press('Home');
  await expect(scrubber).toHaveValue('0');
  await scrubber.press('End');
  await expect(scrubber).toHaveValue('1');
  await expect(scrubber).toHaveAttribute('aria-valuetext', /4/);
  await expect(panel.getByText(/Latest .*minimum .*maximum .*start .*end/).first()).toBeVisible();
  await expect
    .poll(async () => {
      const [bodyFits, panelFits] = await Promise.all([
        page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth + 1),
        panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ]);
      return bodyFits && panelFits;
    })
    .toBe(true);

  const themeToggle = page.getByRole('button', { name: /Switch theme/ });
  await themeToggle.click();
  await themeToggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night-red');
  await expect
    .poll(() =>
      panel.locator('.trend-chart canvas').evaluateAll((canvases) =>
        canvases.every((canvas) => {
          const bitmap = canvas as HTMLCanvasElement;
          const context = bitmap.getContext('2d');
          if (!context) return false;
          const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
          for (let index = 0; index < pixels.length; index += 4) {
            const red = pixels[index];
            const green = pixels[index + 1];
            const blue = pixels[index + 2];
            const alpha = pixels[index + 3];
            if (alpha > 0 && (green > red + 4 || blue > red + 4)) return false;
          }
          return true;
        }),
      ),
    )
    .toBe(true);

  await panel.focus();
  await page.keyboard.press('Shift+Tab');
  const lastScrubber = panel.getByRole('slider', { name: 'Inspect Speed timeline' });
  await expect(lastScrubber).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Back to menu' })).toBeFocused();
});

test('a touch drag on a customize grip reorders the shown instruments', async ({ page }) => {
  await page.goto('/');
  await openInstruments(page);
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
  await openInstruments(page);
  const dock = page.getByRole('dialog', { name: 'Instruments' });
  await expect(dock).toBeVisible();
  // Full-screen mode swaps the close label; this chrome is the only way back on a phone.
  await dock.getByRole('button', { name: 'Close instruments, return to chart' }).click();
  await expect(dock).not.toBeVisible();
});

test('full-screen instruments and chart panels yield ownership to each other', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto('/');
  await openInstruments(page);
  const instruments = page.locator('aside.instruments');
  await expect(instruments).toBeVisible();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Tracks', exact: true })
    .click();
  const tracks = page.getByRole('complementary', { name: 'Tracks' });
  await expect(tracks).toBeVisible();
  await expect(instruments).toBeVisible();

  // The dock and chart panel may coexist on a desktop, but entering the phone layout gives the
  // existing chart panel ownership instead of stacking a full-screen Instruments dialog over it.
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(instruments).not.toBeVisible();
  await expect(tracks).toBeVisible();

  // In the opposite direction, opening full-screen Instruments closes the existing chart panel.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Instruments', exact: true })
    .click();
  await expect(tracks).not.toBeVisible();
  await expect(instruments).toBeVisible();
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
  await page
    .context()
    .route(/^https:\/\/api\.open-meteo\.com\/v1\/forecast(?:\?|$)/, async (route) => {
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
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Forecast' }).click();

  const panel = page.locator('#weather-panel');
  await expect(panel).toBeVisible();
  await expect.poll(() => forecastRequests, { timeout: 15_000 }).toBeGreaterThan(0);
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
