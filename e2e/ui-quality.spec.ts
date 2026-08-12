import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function expectInsideViewport(surface: Locator, page: Page): Promise<void> {
  await expect(surface).toBeVisible();
  const [box, viewport] = await Promise.all([
    surface.boundingBox(),
    page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    })),
  ]);
  if (!box) throw new Error('Floating surface did not lay out.');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test('restores night-red before interaction and updates browser chrome', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:theme', 'night-red');
  });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night-red');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
});

test('keeps primary phone controls touch-sized without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  for (const control of await page.locator('header button:visible').all()) {
    const box = await control.boundingBox();
    if (!box) continue;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await expect
    .poll(() => page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth + 1))
    .toBe(true);
});

test('keeps a status-strip action chip on one control row', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  // The orientation chip is the action chip that needs no server, no stream, and no gesture. It is
  // driven through the menu rather than a seeded key, because chart orientation is a portable
  // profile setting and the starter profile writes north back over a seed at boot.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: /^Orientation/ })
    .click();

  const chip = page.locator('.status-strip .orientation-chip');
  await expect(chip).toBeVisible();
  const action = chip.getByRole('button', { name: 'N up' });
  const [chipBox, actionBox] = await Promise.all([chip.boundingBox(), action.boundingBox()]);
  if (!chipBox || !actionBox) throw new Error('The orientation chip did not lay out.');
  // The action keeps its full touch target, and the chip is that one row rather than a label line
  // with the target stacked beneath it, which used to cost the chart an extra row per chip.
  expect(actionBox.height).toBeGreaterThanOrEqual(44);
  expect(chipBox.height).toBeLessThanOrEqual(actionBox.height + 1);
  // A chip that grew wider than it is tall must still not push the strip sideways.
  await expect
    .poll(() => page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth + 1))
    .toBe(true);
});

test('keeps a scrolled layer opacity popover inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Layers and charts', exact: true })
    .click();
  const panel = page.locator('#layers-panel');
  const tabs = panel.getByLabel('Layers and charts view');
  await tabs.getByRole('button', { name: 'Overlays' }).click();
  const adjust = panel.getByRole('button', { name: /^Adjust .* opacity$/ }).last();
  await adjust.scrollIntoViewIfNeeded();
  await adjust.click();

  await expectInsideViewport(page.locator('.tune-pop'), page);
});

test('constrains a long toolbar More menu on a short display', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 320 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      'binnacle:pinned-actions',
      JSON.stringify([
        'center',
        'follow',
        'routes',
        'tracks',
        'waypoints',
        'poi-search',
        'measure',
        'layers',
        'instruments',
        'profiles',
      ]),
    );
  });
  await page.goto('/');

  await page.getByRole('button', { name: /More actions \(/ }).click();
  const menu = page.locator('.bar-more');
  await expectInsideViewport(menu, page);
  await expect
    .poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
});

test('keeps the attribution control collapsed', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  // MapLibre's compact attribution auto-expands itself whenever attribution content changes; the
  // app strips the expansion class on every styledata, sourcedata, and terrain tick. This pins
  // that private-internals dependency (the maplibregl-compact-show class) so a MapLibre upgrade
  // that changes the control's internals fails here instead of silently regressing the chart.
  const attributionControl = page.locator('.maplibregl-ctrl-attrib');
  await expect(attributionControl).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() =>
      attributionControl.evaluate((control) =>
        control.classList.contains('maplibregl-compact-show'),
      ),
    )
    .toBe(false);
});

test('keeps chart controls legible and the instrument title on one line', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  const attribution = page.locator('.maplibregl-ctrl-attrib-button');
  await expect(attribution).toHaveCSS('background-image', 'none');
  await expect
    .poll(() => attribution.evaluate((button) => getComputedStyle(button, '::after').maskSize))
    .toBe('20px 20px');
  const scale = page.locator('.maplibregl-ctrl-scale');
  await expect(scale).toBeVisible({ timeout: 15_000 });
  // The open-bracket scale bar: mono label, no "Scale" word, and no top border, so it reads as a
  // measuring bracket rather than a form card.
  await expect
    .poll(() => scale.evaluate((element) => getComputedStyle(element, '::before').content), {
      timeout: 15_000,
    })
    .toBe('none');
  await expect(scale).toHaveCSS('border-top-style', 'none');
  await expect
    .poll(() => scale.evaluate((element) => getComputedStyle(element).fontFamily))
    .toContain('JetBrains');
  await expect
    .poll(() =>
      scale.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth + 1 &&
          element.scrollHeight <= element.clientHeight + 1,
      ),
    )
    .toBe(true);
  await expect(page.locator('.maplibregl-ctrl-top-right button')).toHaveCount(2);
  await expect(page.locator('.maplibregl-ctrl-bottom-right')).toHaveCSS('bottom', '12px');

  const pinnedInstruments = page.getByRole('button', { name: 'Instruments', exact: true }).first();
  if (await pinnedInstruments.isVisible()) {
    await pinnedInstruments.click();
  } else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page
      .locator('#app-menu-launcher')
      .getByRole('button', { name: 'Instrument dock', exact: true })
      .click();
  }
  const heading = page.getByRole('heading', { name: 'Instruments', exact: true });
  await expect(heading).toBeVisible();
  await expect
    .poll(() =>
      heading.evaluate((element) => {
        const textRange = document.createRange();
        textRange.selectNodeContents(element);
        return textRange.getClientRects().length;
      }),
    )
    .toBe(1);
  await expect(page.getByRole('button', { name: 'Customize instruments' })).toHaveText('Customize');
  await expect
    .poll(async () => {
      const [mapBox, scaleBox] = await Promise.all([
        page.locator('.maplibregl-map').boundingBox(),
        scale.boundingBox(),
      ]);
      if (!mapBox || !scaleBox) return false;
      return scaleBox.x + scaleBox.width <= mapBox.x + mapBox.width;
    })
    .toBe(true);
});

test('keeps long battery readings distinguishable in a night-red tablet dock', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:theme', 'night-red');
  });
  await page.route(/\/signalk\/v1\/api\/vessels\/self\/electrical\/batteries$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        veryLongHouseBatteryBank: {
          voltage: { value: 12.7 },
          capacity: { stateOfCharge: { value: 0.8 }, timeRemaining: { value: 7200 } },
          current: { value: -4.2 },
        },
      }),
    }),
  );

  await page.goto('/');
  // The dock is not a default toolbar pin, so open it from the launcher.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Instrument dock', exact: true })
    .click();
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night-red');
  await dock.getByRole('button', { name: 'Customize instruments' }).click();
  const labels = [
    'Voltage · Very Long House Battery Bank',
    'State of charge · Very Long House Battery Bank',
    'Time remaining · Very Long House Battery Bank',
    'Current · Very Long House Battery Bank',
  ];
  for (const label of labels) {
    const checkbox = dock.getByRole('checkbox', { name: label, exact: true });
    await expect(checkbox).toBeVisible();
    await checkbox.check();
  }
  await dock.getByRole('button', { name: 'Done' }).click();
  for (const label of labels) {
    await expect(dock.getByRole('button', { name: new RegExp(`^${label},`) })).toBeVisible();
  }
  await expect
    .poll(async () => {
      const [bodyFits, dockFits] = await Promise.all([
        page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth + 1),
        dock.evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1),
      ]);
      return bodyFits && dockFits;
    })
    .toBe(true);
});

test('honors reduced motion and keeps menu keyboard focus contained', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  const menuButton = page.getByRole('button', { name: 'Menu', exact: true });
  await menuButton.click();
  const menu = page.locator('#app-menu-launcher');
  const first = menu.getByRole('button').first();
  await first.focus();
  await page.keyboard.press('Tab');
  await expect(menu.locator(':focus')).toHaveCount(1);
  await expect(first).toHaveCSS('transition-duration', /1e-05s|0\.00001s|0\.01ms/);
});

test('has no serious or critical automated accessibility violations', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
});
