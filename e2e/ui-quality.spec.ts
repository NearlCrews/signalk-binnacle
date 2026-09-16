import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import {
  contrastRatio,
  expectHelmHitTarget,
  expectInsideViewport,
  expectNoHorizontalOverflow,
  FIXTURE_ORIGIN,
  openMenuItem,
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
  await expect(
    launcher.getByRole('button', { name: 'Move Follow boat, position 2 of 4', exact: true }),
  ).toBeVisible();
  await expect(menu).not.toBeVisible();
  await expect(
    launcher.getByRole('button', { name: 'Move Follow boat, position 2 of 4', exact: true }),
  ).toBeFocused();
  const reset = launcher.getByRole('button', { name: 'Reset toolbar' });
  await reset.click();
  await launcher.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(reset).toBeFocused();
  await expect(
    launcher.getByRole('button', { name: 'Move Follow boat, position 2 of 4', exact: true }),
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
      // The no-fix grace state grows the strip, so settle it before scrolling panel controls.
      await expect(page.getByRole('status').filter({ hasText: 'Waiting for GPS' })).toBeVisible({
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
              .locator('header')
              .getByRole('button', { name: 'Mark man overboard here', exact: true }),
          );
        } else {
          const instrument = panel.locator('.tiles button').first();
          await instrument.scrollIntoViewIfNeeded();
          await expectHelmHitTarget(instrument);
          await expectHelmHitTarget(
            (viewport.width <= 600 ? panel : page.locator('header')).getByRole('button', {
              name: 'Mark man overboard here',
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
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  const themeToggle = page.getByRole('button', { name: /Switch theme/ });
  await themeToggle.focus();
  await expect(themeToggle).toHaveCSS('outline-width', '2px');
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

  const mob = page.locator('header').getByRole('button', { name: 'Mark man overboard here' });
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
  await expect(page.locator('.maplibregl-ctrl-bottom-right')).toHaveCSS('bottom', '12px');

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
    const checkbox = dock.getByRole('checkbox', { name: label, exact: true });
    await expect(checkbox).toBeVisible();
    await checkbox.check();
  }
  await dock.getByRole('button', { name: 'Done' }).click();
  for (const label of labels) {
    await expect(dock.getByRole('button', { name: new RegExp(`^${label},`) })).toBeVisible();
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

  await page.locator('header').getByRole('button', { name: 'Mark man overboard here' }).click();
  const mobDialog = page.getByRole('alertdialog', { name: 'Man overboard' });
  await expect(mobDialog).toBeVisible();
  await expectRelevantAxeClean(page, 'MOB confirmation dialog');
});
