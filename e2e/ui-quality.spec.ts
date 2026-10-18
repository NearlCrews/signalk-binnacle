import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import {
  colorShare,
  contrastRatio,
  expectHelmHitTarget,
  expectInsideViewport,
  expectNoHorizontalOverflow,
  FIXTURE_ORIGIN,
  openMenuItem,
  requireBox,
  setRootFontSize,
  stubVesselsSelf,
  waitForSignalKConnection,
} from './helpers';

test.use({ serviceWorkers: 'block' });

test('reorders toolbar actions by taps and restores focus after canceling reset', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const launcher = page.locator('#app-menu-launcher');
  await launcher.getByRole('button', { name: 'Customize toolbar' }).click();
  const reorder = launcher.getByRole('button', { name: 'Reorder Follow boat', exact: true });
  await reorder.scrollIntoViewIfNeeded();
  await expectHelmHitTarget(reorder);
  await reorder.click();
  const menu = page.getByRole('menu', { name: 'Reorder Follow boat', exact: true });
  const moveUp = menu.getByRole('menuitem', { name: 'Move up' });
  await expect(moveUp).toBeFocused();
  await expectHelmHitTarget(moveUp);
  await moveUp.click();
  // The default bar is Center, Follow, Charts, and AIS, so Follow moves to the front.
  await expect(
    launcher.getByRole('button', { name: 'Move Follow boat, position 1 of 4', exact: true }),
  ).toBeVisible();
  await expect(menu).not.toBeVisible();
  await expect(
    launcher.getByRole('button', { name: 'Move Follow boat, position 1 of 4', exact: true }),
  ).toBeFocused();
  const reset = launcher.getByRole('button', { name: 'Reset toolbar' });
  await reset.click();
  await launcher.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(reset).toBeFocused();
  await expect(
    launcher.getByRole('button', { name: 'Move Follow boat, position 1 of 4', exact: true }),
  ).toBeVisible();
});

test('resolves CSS Color 4 and translucent surfaces for contrast checks', async ({ page }) => {
  await page.setContent(
    '<div style="background: white"><span id="sample" style="color: color(srgb 0 0 0); background: rgb(0 0 0 / 50%)">Reading</span></div>',
  );
  const ratio = await contrastRatio(page.locator('#sample'));
  expect(ratio).toBeGreaterThan(5);
  expect(ratio).toBeLessThan(5.4);
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 1024, height: 768 },
]) {
  for (const fontSize of [16, 24, 32]) {
    test(`reflows panel headers at ${viewport.width}x${viewport.height} with ${fontSize}px text`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem('binnacle:help-orientation', 'true');
      });
      await stubVesselsSelf(page);
      await page.goto(FIXTURE_ORIGIN);
      await waitForSignalKConnection(page);
      // Settle the no-fix grace state before scrolling panel controls.
      await expect(page.locator('.status-strip .status-cell')).toContainText('No GPS', {
        timeout: 15_000,
      });
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}px`;
      }, fontSize);
      for (const [label, panelName, closeName] of [
        ['Help', 'Help and helm setup', 'Close help'],
        ['Layers and charts', 'Layers and charts', 'Close layers and charts'],
        ['Instrument dock', 'Instruments', 'Close instruments'],
      ]) {
        await openMenuItem(page, label);
        const panel = page.getByRole(
          panelName === 'Instruments' && viewport.width <= 600 ? 'dialog' : 'complementary',
          {
            name: panelName,
            exact: true,
          },
        );
        await expect(panel).toBeVisible();
        const close = panel.getByRole('button', { name: new RegExp(`^${closeName}`) });
        await expectInsideViewport(close, page);
        await expect
          .poll(() =>
            panel.evaluate((element) => {
              const header = element.querySelector('.panel-header')?.getBoundingClientRect();
              return header ? element.getBoundingClientRect().bottom - header.bottom : 0;
            }),
          )
          .toBeGreaterThanOrEqual(44);
        await expectNoHorizontalOverflow(panel);
        if (panelName !== 'Instruments') {
          const bodyAction = panel.locator('.panel-body button:visible:not(:disabled)').first();
          await bodyAction.scrollIntoViewIfNeeded();
          await expectHelmHitTarget(bodyAction);
          await expectHelmHitTarget(
            page
              .locator('.status-strip')
              .getByRole('button', { name: 'MOB: mark man overboard here', exact: true }),
          );
        } else {
          const instrument = panel.locator('.tiles button').first();
          await instrument.scrollIntoViewIfNeeded();
          await expectHelmHitTarget(instrument);
          await expectHelmHitTarget(
            (viewport.width <= 600 ? panel : page.locator('.status-strip')).getByRole('button', {
              name: 'MOB: mark man overboard here',
              exact: true,
            }),
          );
        }
        await close.click();
      }
      expect(pageErrors).toEqual([]);
    });
  }
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 1024, height: 768 },
]) {
  test(`keeps enlarged editor actions and icon choices reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('binnacle:help-orientation', 'true');
    });
    await stubVesselsSelf(page);
    await page.goto(FIXTURE_ORIGIN);
    await waitForSignalKConnection(page);
    const canvas = page.locator('canvas[aria-label="Navigation chart"]');
    await expect(page.locator('.maplibregl-ctrl-scale')).toContainText(/nm|km/);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    for (const [menuLabel, dialogName, pickerLabel] of [
      ['Add note here', 'Add personal note', 'Symbol'],
      ['Drop waypoint', 'Add waypoint', 'Icon'],
    ]) {
      await canvas.focus();
      await page.keyboard.press('Shift+F10');
      await page.getByRole('menuitem', { name: menuLabel, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
      await expect(dialog).toBeVisible();
      const bodySpace = await dialog.locator('.dialog-body').evaluate((body) => {
        const style = getComputedStyle(body);
        return (
          body.clientHeight -
          Number.parseFloat(style.paddingBlockStart) -
          Number.parseFloat(style.paddingBlockEnd)
        );
      });
      expect(bodySpace).toBeGreaterThanOrEqual(44);
      await expectInsideViewport(dialog.locator('.dialog-footer'), page);
      for (const action of await dialog.locator('.dialog-footer button').all()) {
        await expectInsideViewport(action, page);
        if (await action.isEnabled()) await expectHelmHitTarget(action);
      }
      await expectInsideViewport(dialog.getByRole('button', { name: 'Cancel', exact: true }), page);
      await dialog.getByLabel(pickerLabel, { exact: true }).click();
      const choices = page.getByRole('listbox', { name: 'Icon', exact: true });
      await expectInsideViewport(choices, page);
      await expect(choices.getByRole('option').first()).toBeFocused();
      await page.keyboard.press('End');
      await expect(choices.getByRole('option').last()).toBeFocused();
      await page.keyboard.press('Home');
      await expect(choices.getByRole('option').first()).toBeFocused();
      await page.keyboard.press('m');
      await expect(choices.getByRole('option', { name: 'Marina', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expectNoHorizontalOverflow(dialog.locator('.dialog-body'));
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  });
}

test('keeps the night-red active profile badge readable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.clear());
  await stubVesselsSelf(page);
  await page.goto('/');
  await openMenuItem(page, /^Profiles/);
  const panel = page.getByRole('complementary', { name: 'Profiles' });
  const useNight = panel.getByRole('button', {
    name: 'Use Night passage on this device',
    exact: true,
  });
  await expect(useNight).toBeVisible({ timeout: 20_000 });
  await useNight.click();
  const row = panel.getByRole('listitem').filter({
    has: page.getByText('Night passage', { exact: true }),
  });
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night-red');
  const badge = row.getByText('Active here', { exact: true });
  await expect(badge).toBeVisible();
  expect(await contrastRatio(badge)).toBeGreaterThanOrEqual(4.5);
});

async function expectRelevantAxeClean(page: Page, state: string): Promise<void> {
  // Svelte's short fly transition changes effective foreground and background colors while the
  // surface is entering. Audit the settled state, not a deliberately translucent animation frame.
  await page.waitForTimeout(250);
  const results = await new AxeBuilder({ page }).analyze();
  const watchedRules = new Set([
    'aria-allowed-role',
    'aria-prohibited-attr',
    'color-contrast',
    'landmark-unique',
  ]);
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === 'serious' ||
        violation.impact === 'critical' ||
        watchedRules.has(violation.id),
    ),
    `Accessibility violations in ${state}`,
  ).toEqual([]);
}

test('restores night-red before interaction and updates browser chrome', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:theme', 'night-red');
  });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night-red');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000');
  await expect(
    page.getByRole('heading', { level: 1, name: /Binnacle Chartplotter/ }),
  ).toBeAttached();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(menu).toBeVisible();
  await menu.focus();
  await expect(menu).toHaveCSS('outline-width', '2px');
});

test('keeps primary phone controls touch-sized without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  for (const control of await page.locator('.status-strip button:visible').all()) {
    const box = await control.boundingBox();
    if (!box) continue;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page.locator('body'));
});

test('keeps the MOB key and active controls contrast-safe in the marine palettes', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:theme', 'night-red');
  });
  await page.reload();

  const mob = page
    .locator('.status-strip')
    .getByRole('button', { name: 'MOB: mark man overboard here' });
  await expect(mob).toBeVisible({ timeout: 20_000 });
  expect(await contrastRatio(mob)).toBeGreaterThanOrEqual(4.5);

  await page.evaluate(() => localStorage.setItem('binnacle:theme', 'dusk'));
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Customize toolbar' }).click();
  const activeTile = page.locator('#app-menu-launcher .menu-tile.is-on').first();
  await expect(activeTile).toBeVisible();
  expect(await contrastRatio(activeTile)).toBeGreaterThanOrEqual(4.5);
});

test('keeps text-entry controls at 16px on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  await openMenuItem(page, 'Find places');
  const search = page.getByRole('searchbox', {
    name: 'Search places by name, category, or source',
  });
  await expect(search).toHaveCSS('font-size', '16px');
  await page.getByRole('button', { name: 'Close find places' }).click();

  await openMenuItem(page, 'Watch handoff');
  await expect(page.getByPlaceholder('Sea state, traffic, engine, anything to watch')).toHaveCSS(
    'font-size',
    '16px',
  );
  await page.getByRole('button', { name: 'Close watch handoff' }).click();

  await openMenuItem(page, 'Alarms');
  const numberInputs = page.getByRole('spinbutton');
  await expect(numberInputs.first()).toBeVisible();
  for (const input of await numberInputs.all()) await expect(input).toHaveCSS('font-size', '16px');
});

test('gives simultaneous navigation and forecast maps unique names', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('canvas[aria-label="Navigation chart"]')).toHaveCount(1);

  await openMenuItem(page, 'Forecast');
  await expect(page.locator('canvas[aria-label="Weather forecast map"]')).toHaveCount(1);
  await expect(page.locator('canvas[aria-label="Map"]')).toHaveCount(0);
});

test('keeps the status-strip Chart cell a full target without widening the strip', async ({
  page,
}) => {
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

  // The Chart cell is its own action, the one-tap return to north up, so the whole cell is the
  // full touch target; with no COG yet the Status cell states the fallback.
  const cell = page.locator('.status-strip .orientation-readout');
  await expect(cell).toBeVisible();
  const box = await requireBox(cell);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.status-strip .status-cell')).toContainText('North up');
  // A long fallback label must still not push the strip sideways.
  await expectNoHorizontalOverflow(page.locator('body'));
});

test('keeps a scrolled layer opacity popover inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  await openMenuItem(page, 'Layers and charts');
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
  // The bottom-right controls sit one chrome gutter (--space-3) above the chart edge, on the same line
  // as the bottom-left badge, not a doubled container inset plus control margin.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const control = document
          .querySelector('.maplibregl-ctrl-bottom-right .maplibregl-ctrl:last-child')
          ?.getBoundingClientRect();
        const chart = document.querySelector('.maplibregl-map')?.getBoundingClientRect();
        return control && chart ? Math.round(chart.bottom - control.bottom) : -1;
      }),
    )
    .toBe(12);

  const pinnedInstruments = page.getByRole('button', { name: 'Instruments', exact: true }).first();
  if (await pinnedInstruments.isVisible()) {
    await pinnedInstruments.click();
  } else {
    await openMenuItem(page, 'Instrument dock');
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
  await openMenuItem(page, 'Instrument dock');
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
    const checkbox = dock.getByRole('switch', { name: label, exact: true });
    await expect(checkbox).toBeVisible();
    await checkbox.check();
  }
  await dock.getByRole('button', { name: 'Done' }).click();
  for (const label of labels) {
    // A tile is named by what it shows, the reading and then its full label.
    await expect(dock.getByRole('button', { name: label })).toBeVisible();
  }
  await expectNoHorizontalOverflow(page.locator('body'));
  await expectNoHorizontalOverflow(dock);
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
  await expect(first).toHaveCSS('transition-duration', '0s');
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

test('keeps major overlay states accessibility-clean', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the cross-engine smoke stays in the focused UI tests');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());

  for (const theme of ['day', 'dusk', 'night-red']) {
    await page.evaluate((nextTheme) => localStorage.setItem('binnacle:theme', nextTheme), theme);
    await page.reload();
    await expect(page.locator('canvas[aria-label="Navigation chart"]')).toBeVisible({
      timeout: 20_000,
    });
    await expectRelevantAxeClean(page, `settled ${theme}`);
  }

  await page.evaluate(() => localStorage.setItem('binnacle:theme', 'dusk'));
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Customize toolbar' }).click();
  await expectRelevantAxeClean(page, 'toolbar customization');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#app-menu-launcher')).toBeHidden();

  await openMenuItem(page, 'Forecast');
  await expect(page.locator('canvas[aria-label="Weather forecast map"]')).toBeVisible({
    timeout: 20_000,
  });
  await expectRelevantAxeClean(page, 'Forecast with two maps');
  await page.getByRole('button', { name: 'Close weather' }).click();

  await openMenuItem(page, 'Instrument dock');
  const instruments = page.getByRole('dialog', { name: 'Instruments' });
  await expect(instruments).toBeVisible();
  await expectRelevantAxeClean(page, 'full-screen Instruments');
  await instruments.getByRole('button', { name: 'Close instruments, return to chart' }).click();

  await openMenuItem(page, 'Data trends');
  const trends = page.getByRole('dialog', { name: 'Data trends' });
  await expect(trends).toBeVisible();
  await expectRelevantAxeClean(page, 'full-screen Data trends');
  await trends.getByRole('button', { name: 'Close trends, return to chart' }).click();

  await page
    .locator('.status-strip')
    .getByRole('button', { name: 'MOB: mark man overboard here' })
    .click();
  const mobDialog = page.getByRole('alertdialog', { name: 'Man overboard' });
  await expect(mobDialog).toBeVisible();
  await expectRelevantAxeClean(page, 'MOB confirmation dialog');
});

test('paints the day chart in the paper chart palette', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('binnacle:help-orientation', 'true');
    localStorage.setItem('binnacle:theme', 'day');
  });
  await page.context().route(/^https:\/\/tiles\.openfreemap\.org\/styles\/liberty/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
        ],
      }),
    }),
  );
  await stubVesselsSelf(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  const canvas = page.locator('.maplibregl-canvas').first();
  await expect(canvas).toBeVisible();
  // A Desktop Safari canvas at 2x is software-rendered here and its first frame can take several
  // seconds under a full suite, so allow the same 30 s the chart fixtures give a chart.
  await expect
    .poll(async () => colorShare(page, await canvas.screenshot(), [0xf4, 0xe8, 0xc1]), {
      message: 'the day base map should paint the paper chart land color',
      timeout: 30_000,
    })
    .toBeGreaterThan(0.5);
  // The stub's own color must be gone, so a match proves the recolor ran.
  expect(await colorShare(page, await canvas.screenshot(), [0xf8, 0xf4, 0xf0])).toBeLessThan(0.01);
});

test('has no top bar: the chart starts at the top and the brand is for assistive tech only', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.addInitScript(() => localStorage.setItem('binnacle:help-orientation', 'true'));
  await stubVesselsSelf(page);
  await page.goto('/');

  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveAccessibleName('Binnacle Chartplotter');
  expect((await heading.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
  await expect(page.locator('header')).toHaveCount(0);
  expect((await requireBox(page.locator('.chart-host'))).y).toBe(0);
});

for (const width of [320, 360]) {
  test(`a first-run banner at 200-percent text and ${width}px wraps its actions whole`, async ({
    page,
  }) => {
    // The welcome banner's three actions are one equal group; on a narrow host at large text the
    // group must drop to rows of whole buttons rather than spill off both screen edges.
    await page.setViewportSize({ width, height: 800 });
    await setRootFontSize(page, 200);
    await stubVesselsSelf(page);
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    const banner = page.locator('.toast-banner').filter({ hasText: 'First time with Binnacle?' });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    for (const action of await banner.getByRole('button').all()) {
      await expectInsideViewport(action, page);
    }
    await expectNoHorizontalOverflow(page.locator('body'));
  });
}

// The bar's two ends hold at every size and text size: the full height of the bar, at its two
// edges, and every readout whole inside its own box. A short screen pins the control height at 44 px
// while enlarged text keeps growing a cell's two lines, which once drew one row's values over the
// next.
for (const [width, height, text] of [
  [1400, 700, 100],
  [1920, 1080, 100],
  [1600, 900, 100],
  [844, 390, 100],
  [390, 760, 100],
  [360, 640, 100],
  [568, 320, 100],
  [568, 320, 200],
  [852, 393, 150],
  [852, 393, 200],
  [1024, 500, 200],
  [390, 844, 200],
  [320, 568, 200],
] as const) {
  test(`the bar's ends and readouts hold at ${width}x${height} and ${text}-percent text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    if (text !== 100) await setRootFontSize(page, text);
    await page.addInitScript(() => localStorage.setItem('binnacle:help-orientation', 'true'));
    await stubVesselsSelf(page);
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    const mob = page.getByRole('button', { name: 'MOB: mark man overboard here' });
    await expect(mob).toBeVisible({ timeout: 20_000 });
    await expect(menu).toBeVisible();
    await expect(page.locator('.status-strip .status-cell')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const grid = document.querySelector('.strip-grid')?.getBoundingClientRect();
          const ends = [...document.querySelectorAll('.bar-bookend')].map((end) =>
            end.getBoundingClientRect(),
          );
          if (!grid || ends.length !== 2) return ['bar not laid out'];
          const faults: string[] = [];
          for (const end of ends)
            if (Math.abs(end.height - grid.height) > 1) faults.push('an end is not full height');
          if (Math.abs((ends[0]?.left ?? 0) - grid.left) > 1) faults.push('menu is off the edge');
          if (Math.abs((ends[1]?.right ?? 0) - grid.right) > 1) faults.push('MOB is off the edge');
          for (const part of document.querySelectorAll<HTMLElement>(
            '.strip-readouts .data-cell-value, .strip-readouts .word',
          ))
            if (part.scrollWidth > part.clientWidth + 0.5)
              faults.push(`${part.textContent?.trim()} is cut`);
          const cells = [
            ...document.querySelectorAll<HTMLElement>('.strip-readouts .data-cell'),
          ].filter((cell) => cell.offsetParent !== null);
          for (const cell of cells)
            if (cell.scrollHeight > cell.clientHeight + 0.5)
              faults.push(`${cell.textContent?.trim()} spills out of its cell`);
          const boxes = cells.map((cell) => cell.getBoundingClientRect());
          for (const [i, a] of boxes.entries())
            for (const b of boxes.slice(i + 1))
              if (
                a.left < b.right - 0.5 &&
                b.left < a.right - 0.5 &&
                a.top < b.bottom - 0.5 &&
                b.top < a.bottom - 0.5
              )
                faults.push('two readouts overlap');
          return faults;
        }),
      )
      .toEqual([]);
    await expectNoHorizontalOverflow(page.locator('body'));
  });
}

test('the Status cell keeps its box when problems come and go', async ({ page, context }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.addInitScript(() => localStorage.setItem('binnacle:help-orientation', 'true'));
  await stubVesselsSelf(page);
  await page.goto('/');
  const cell = page.locator('.status-strip .status-cell');
  await expect(cell).toBeVisible({ timeout: 20_000 });
  const before = await requireBox(cell);
  await context.setOffline(true);
  await expect(cell).toContainText('Offline');
  const during = await requireBox(cell);
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(during[key] - before[key])).toBeLessThanOrEqual(0.5);
  await cell.click();
  const list = page.getByRole('dialog', { name: 'Status' });
  await expect(list).toBeVisible();
  await expect(list).toContainText('This device has no network connection');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(cell).toBeFocused();
  await context.setOffline(false);
});

for (const [width, height] of [
  [390, 760],
  [1400, 700],
] as const) {
  test(`MOB is one tap away with the menu open at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('binnacle:help-orientation', 'true'));
    await stubVesselsSelf(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(page.locator('#app-menu-launcher')).toBeVisible();
    const mob = page.getByRole('button', { name: 'MOB: mark man overboard here' });
    // Nothing the menu opened sits over MOB.
    expect(
      await mob.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return element.contains(top);
      }),
    ).toBe(true);
    await mob.click();
    await expect(page.getByRole('alertdialog', { name: 'Man overboard' })).toBeVisible();
    await expect(page.locator('#app-menu-launcher')).toBeHidden();
  });
}

test('MOB is the second focus stop, right after the menu', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.addInitScript(() => localStorage.setItem('binnacle:help-orientation', 'true'));
  await stubVesselsSelf(page);
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(menu).toBeVisible({ timeout: 20_000 });
  await menu.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'MOB: mark man overboard here' })).toBeFocused();
});

test('opening the instrument dock leaves MOB where it was', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.addInitScript(() => localStorage.setItem('binnacle:help-orientation', 'true'));
  await stubVesselsSelf(page);
  await page.goto('/');
  const mob = page.getByRole('button', { name: 'MOB: mark man overboard here' });
  await expect(mob).toBeVisible({ timeout: 20_000 });
  const before = await requireBox(mob);
  await openMenuItem(page, 'Instrument dock');
  await expect(page.locator('.instruments')).toBeVisible();
  const after = await requireBox(mob);
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(after[key] - before[key])).toBeLessThanOrEqual(0.5);
});

test('bar tiles and ends center their icon and label', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.addInitScript(() => localStorage.setItem('binnacle:help-orientation', 'true'));
  await stubVesselsSelf(page);
  await page.goto('/');
  await expect(page.locator('.bar-tile').first()).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  const faults = await page.evaluate(() => {
    const out: string[] = [];
    for (const control of document.querySelectorAll<HTMLElement>('.bar-tile, .bar-bookend')) {
      const icon = control.querySelector('svg')?.getBoundingClientRect();
      const text = control.querySelector('.tile-label .truncate, .bar-bookend-label')?.firstChild;
      if (!icon || !text) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      const label = range.getBoundingClientRect();
      // The pair as a block, centered in the control's own content.
      const box = control.getBoundingClientRect();
      const above = icon.top - box.top;
      const below = box.bottom - label.bottom;
      if (Math.abs(above - below) > 1.5)
        out.push(`${control.textContent?.trim()}: ${above} vs ${below}`);
    }
    return out;
  });
  expect(faults).toEqual([]);
});
