import { expect, type Page, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

interface JsonPatchOperation {
  op: 'test' | 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
}

function profileDocument() {
  const settings = {
    theme: 'day',
    layers: {},
    layerOrder: [],
    weatherLayers: {},
    thresholds: {
      dangerCpaMeters: 926,
      dangerTcpaSeconds: 600,
      warningCpaMeters: 1852,
      warningTcpaSeconds: 1200,
    },
    trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
    planningSpeedKn: 6,
    units: 'metric',
    pinnedActionIds: ['center', 'follow', 'layers', 'instruments'],
    instrumentTiles: ['sog', 'heading', 'depth'],
    anchorRadiusMeters: 50,
  };
  return {
    schemaVersion: 2,
    revision: 1,
    profiles: {
      helm: {
        id: 'helm',
        name: 'Test helm',
        settings,
        createdAt: 1,
        updatedAt: 1,
        nameUpdatedAt: 1,
        settingUpdatedAt: Object.fromEntries(Object.keys(settings).map((key) => [key, 1])),
      },
    },
    tombstones: {},
    defaultId: 'helm',
  };
}

function pointerSegments(path: string): string[] {
  return path
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function applyPatch(document: Record<string, unknown>, patch: JsonPatchOperation[]): void {
  for (const operation of patch) {
    const segments = pointerSegments(operation.path);
    let parent: Record<string, unknown> = document;
    for (const segment of segments.slice(0, -1)) {
      const child = parent[segment];
      if (typeof child !== 'object' || child === null || Array.isArray(child)) {
        throw new Error(`Invalid patch parent: ${operation.path}`);
      }
      parent = child as Record<string, unknown>;
    }
    const key = segments.at(-1);
    if (!key) throw new Error(`Invalid patch path: ${operation.path}`);
    if (operation.op === 'test') {
      expect(parent[key]).toEqual(operation.value);
    } else if (operation.op === 'remove') {
      delete parent[key];
    } else {
      parent[key] = structuredClone(operation.value);
    }
  }
}

async function installProfileServer(page: Page, document: Record<string, unknown>): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      'binnacle:signalk-auth',
      JSON.stringify({ clientId: 'binnacle-e2e', token: 'profile-token' }),
    );
  });
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route(
    /\/signalk\/v1\/applicationData\/user\/signalk-binnacle\/2\.0\.0$/,
    async (route) => {
      if (route.request().method() === 'POST') {
        applyPatch(document, route.request().postDataJSON() as JsonPatchOperation[]);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify('ApplicationData saved'),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(document),
      });
    },
  );
}

test('profile overflow actions stay inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const serverDocument = profileDocument() as Record<string, unknown>;
  await installProfileServer(page, serverDocument);
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Profiles', exact: true })
    .click();
  const panel = page.getByRole('complementary', { name: 'Profiles' });
  await panel.getByRole('button', { name: 'More actions for Test helm' }).click();

  const actions = page.getByRole('menu', { name: 'More actions for Test helm' });
  await expect(actions).toBeVisible();
  const box = await actions.boundingBox();
  if (!box) throw new Error('Profile overflow menu did not lay out.');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(box.y + box.height).toBeLessThanOrEqual(640);
});

test('profiles restore instrument order in a different browser', async ({ browser, page }) => {
  const serverDocument = profileDocument() as Record<string, unknown>;
  await installProfileServer(page, serverDocument);
  await page.goto('/');

  await page.getByRole('button', { name: 'Instruments' }).first().click();
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await dock.getByRole('button', { name: 'Customize instruments' }).click();
  const shownTitles = () =>
    page.$$eval('.tile-list li[data-tile-row] .title', (elements) =>
      elements.map((element) => element.textContent?.trim()),
    );
  await expect.poll(async () => (await shownTitles())[0]).toBe('Speed');

  const grip = dock.locator('.tile-list .handle').first();
  const box = await grip.boundingBox();
  if (!box) throw new Error('Instrument reorder grip did not lay out.');
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const point = (nextY: number) => [{ x, y: nextY, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(y) });
  for (const offset of [20, 60, 110]) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(y + offset),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await shownTitles())[0]).not.toBe('Speed');

  const serverInstrumentOrder = () => {
    const profiles = serverDocument.profiles as Record<
      string,
      { settings: { instrumentTiles: string[] } }
    >;
    return profiles.helm.settings.instrumentTiles;
  };
  await expect.poll(serverInstrumentOrder).not.toEqual(['sog', 'heading', 'depth']);

  const secondContext = await browser.newContext({ serviceWorkers: 'block' });
  const secondPage = await secondContext.newPage();
  await installProfileServer(secondPage, serverDocument);
  await secondPage.goto('/');

  await secondPage.getByRole('button', { name: 'Menu' }).click();
  await secondPage
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Profiles', exact: true })
    .click();
  const profiles = secondPage.getByRole('complementary', { name: 'Profiles' });
  await expect(profiles.getByText('Profiles are synced with this Signal K account.')).toBeVisible();
  await expect(profiles.getByText('Active here')).toBeVisible();
  await profiles.getByRole('button', { name: 'Close profiles panel' }).click();

  await secondPage.getByRole('button', { name: 'Instruments' }).first().click();
  const secondDock = secondPage.getByRole('complementary', { name: 'Instruments' });
  await secondDock.getByRole('button', { name: 'Customize instruments' }).click();
  const restoredTitles = await secondPage.$$eval(
    '.tile-list li[data-tile-row] .title',
    (elements) => elements.map((element) => element.textContent?.trim()),
  );
  const titleById: Record<string, string> = {
    sog: 'Speed',
    heading: 'Heading',
    depth: 'Depth',
  };
  expect(restoredTitles).toEqual(serverInstrumentOrder().map((id) => titleById[id]));

  await secondContext.close();
});
