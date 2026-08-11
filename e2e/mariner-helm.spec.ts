import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

// The mariner helm scenarios: emergency reachability, alarm pileups, and staleness honesty under
// phone-sized, landscape, large-text, and safe-area conditions. This project runs against the
// Signal K stream fixture (scripts/signalk-fixture-server.mjs), which serves the built app and a
// real /signalk/v1/stream WebSocket, because the app's stream opens inside the Comlink worker
// where Playwright's routeWebSocket cannot reach. REST endpoints stay page.route stubs here,
// matching the rest of the suite.
//
// Defect-demonstrating cases carry test.fail() with the task that flips them green; remove the
// marker in that task's commit. Radar-health and route-edit scenarios join in their own tasks
// (Tasks 2.2 and 2.6), which extend this spec.

test.use({ serviceWorkers: 'block' });

const FIXTURE_ORIGIN = 'http://127.0.0.1:4174';
// A deterministic wall-clock stamp for every fixture delta; freshness derives from receipt time.
const FIXED_TIMESTAMP = '2026-08-10T12:00:00.000Z';
const TARGET_CONTEXT = 'vessels.urn:mrn:imo:mmsi:366123456';

type DeltaValue = { path: string; value: unknown; state?: unknown };

async function fixturePost(page: Page, action: string, body?: unknown): Promise<void> {
  const response = await page.request.post(`${FIXTURE_ORIGIN}/__fixture__/${action}`, {
    data: body ?? {},
  });
  expect(response.ok()).toBe(true);
}

async function sendDelta(
  page: Page,
  values: DeltaValue[],
  context?: string,
  sourceRef?: string,
): Promise<void> {
  await fixturePost(page, 'delta', {
    ...(context === undefined ? {} : { context }),
    updates: [
      {
        ...(sourceRef === undefined ? {} : { $source: sourceRef }),
        timestamp: FIXED_TIMESTAMP,
        values,
      },
    ],
  });
}

// The exact wire shape signalk-server's meta.timeout enforcement emits per timed-out path:
// $source with no source object, value null, and the out-of-band state container carrying the
// last good value.
function staleValue(path: string, lastValue: unknown): DeltaValue {
  return {
    path,
    value: null,
    state: { timedOut: true, lastValue: { timestamp: FIXED_TIMESTAMP, value: lastValue } },
  };
}

const OWN_FIX: DeltaValue[] = [
  { path: 'navigation.position', value: { latitude: 27.7, longitude: -82.7 } },
  { path: 'navigation.speedOverGround', value: 3 },
  { path: 'navigation.courseOverGroundTrue', value: 0 },
  { path: 'navigation.headingTrue', value: 0 },
];

const MOB_ALARM: DeltaValue = {
  path: 'notifications.mob',
  value: {
    state: 'emergency',
    method: ['visual', 'sound'],
    message: 'Man overboard',
    position: { latitude: 27.701, longitude: -82.701 },
  },
};

const ANCHOR_DRAG: DeltaValue[] = [
  { path: 'navigation.anchor.position', value: { latitude: 27.7003, longitude: -82.7 } },
  { path: 'navigation.anchor.maxRadius', value: 30 },
  {
    path: 'notifications.navigation.anchor',
    value: { state: 'emergency', method: ['visual', 'sound'], message: 'Anchor dragging' },
  },
];

const GENERIC_ALARM: DeltaValue = {
  path: 'notifications.engine.overTemperature',
  value: { state: 'alarm', method: ['visual', 'sound'], message: 'Engine over temperature' },
};

// A target 500 meters north running straight at the own vessel: CPA near zero, TCPA near 80
// seconds, inside the escalation floors, so the collision strip grades danger.
const CLOSING_TARGET: DeltaValue[] = [
  { path: 'navigation.position', value: { latitude: 27.7045, longitude: -82.7 } },
  { path: 'navigation.courseOverGroundTrue', value: Math.PI },
  { path: 'navigation.speedOverGround', value: 3 },
  { path: 'name', value: 'Fixture Target' },
];

async function stubRestApis(page: Page): Promise<void> {
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  // The weather panel's external providers: failed fetches leave the panel in its error state,
  // which is all the layout scenarios need.
  await page.route(/open-meteo\.com|rainviewer\.com/, (route) => route.fulfill({ status: 500 }));
}

async function openApp(page: Page): Promise<void> {
  await fixturePost(page, 'reset');
  await stubRestApis(page);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('.status-strip .conn')).toHaveAttribute('title', /Connected/, {
    timeout: 20_000,
  });
}

async function raiseMob(page: Page): Promise<Locator> {
  await sendDelta(page, [...OWN_FIX, MOB_ALARM]);
  const strip = page.getByRole('complementary', { name: 'Man overboard' });
  await expect(strip).toBeVisible();
  return strip;
}

async function openForecast(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Forecast', exact: true })
    .click();
}

// Full visibility for an emergency control: inside the viewport, not cropped by any
// overflow-clipping ancestor, and hit-testable at its center. A bounding-box check alone misses
// the overflow: hidden crop, because a clipped element still reports a box.
async function expectActionReachable(action: Locator): Promise<void> {
  await expect(action).toBeVisible();
  const failure = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const round = (box: DOMRect) =>
      `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)},${Math.round(box.bottom)}`;
    if (
      rect.left < 0 ||
      rect.top < 0 ||
      rect.right > viewportWidth ||
      rect.bottom > viewportHeight
    ) {
      return `outside viewport ${viewportWidth}x${viewportHeight}: ${round(rect)}`;
    }
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const overflow = style.overflow + style.overflowX + style.overflowY;
      if (!/(hidden|auto|scroll|clip)/.test(overflow)) continue;
      const box = node.getBoundingClientRect();
      if (
        rect.top < box.top - 0.5 ||
        rect.bottom > box.bottom + 0.5 ||
        rect.left < box.left - 0.5 ||
        rect.right > box.right + 0.5
      ) {
        return `clipped by ${node.className || node.tagName}: ${round(rect)} vs ${round(box)}`;
      }
    }
    const centerHit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    if (!centerHit || !(element.contains(centerHit) || centerHit.contains(element))) {
      return `center hit-test resolves to ${centerHit?.tagName ?? 'nothing'}`;
    }
    return null;
  });
  expect(failure).toBeNull();
}

async function expectMobActionsReachable(strip: Locator): Promise<void> {
  await expectActionReachable(strip.getByRole('button', { name: 'Steer to MOB' }));
  await expectActionReachable(strip.getByRole('button', { name: 'Acknowledge' }));
  await expectActionReachable(strip.getByRole('button', { name: 'Cancel' }));
}

test('stream fixture feeds the worker: subscriptions arrive and deltas render', async ({
  page,
}) => {
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  await expect(page.locator('.status-strip')).toContainText('5.8');
  const state = await page.request.get(`${FIXTURE_ORIGIN}/__fixture__/state`);
  const body = (await state.json()) as { received: Array<{ subscribe?: unknown }> };
  expect(body.received.some((message) => Array.isArray(message.subscribe))).toBe(true);
});

test('P0: MOB actions stay reachable with Forecast open at 320x568', async ({ page }) => {
  // SAF-01: the emergency rail must never be displaced by the Forecast panel; it stacks above it
  // at the viewport bottom instead.
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  const strip = await raiseMob(page);
  await openForecast(page);
  await expect(strip).toBeVisible();
  await expectMobActionsReachable(strip);
});

test('P0: four hazard families stay reachable through the emergency rail at 320x568', async ({
  page,
}) => {
  // SAF-01: the rail shows the most urgent condition in full, and every other active hazard as a
  // 44-pixel chip that promotes it on tap, so a pileup can never clip a response action.
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  await sendDelta(page, CLOSING_TARGET, TARGET_CONTEXT);
  await sendDelta(page, [...ANCHOR_DRAG, MOB_ALARM, GENERIC_ALARM]);

  // MOB outranks everything: its full strip and response actions are on screen.
  const mob = page.getByRole('complementary', { name: 'Man overboard' });
  await expect(mob).toBeVisible();
  await expectMobActionsReachable(mob);

  // Every other hazard family is visibly represented by a reachable 44-pixel chip.
  const collisionChip = page.getByRole('button', { name: /^Collision danger.*show details$/ });
  const anchorChip = page.getByRole('button', { name: /^Anchor alarm.*show details$/ });
  const alarmsChip = page.getByRole('button', { name: /^Alarms.*show details$/ });
  for (const chip of [collisionChip, anchorChip, alarmsChip]) {
    await expectActionReachable(chip);
    const box = await chip.boundingBox();
    if (!box) throw new Error('chip did not lay out');
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  // A live helm keeps receiving fixes; refresh the geometry so the 10-second freshness windows
  // cannot stand the collision assessment down mid-test, which is correct product behavior.
  await sendDelta(page, OWN_FIX);
  await sendDelta(page, CLOSING_TARGET, TARGET_CONTEXT);

  // Tapping a chip promotes its condition: the collision response actions become reachable, and
  // MOB demotes to a chip without leaving the rail.
  await collisionChip.click();
  const collision = page.getByRole('complementary', { name: 'Collision danger' });
  await expect(collision).toBeVisible();
  await expectActionReachable(collision.getByRole('button', { name: 'Mute' }));
  await expectActionReachable(collision.getByRole('button', { name: 'Acknowledge' }));
  await expectActionReachable(page.getByRole('button', { name: /^Man overboard.*show details$/ }));
});

test('MOB actions stay reachable in landscape 568x320', async ({ page }) => {
  // Held behavior: a lone MOB strip fits the 60dvh cap even at 320 pixels tall. Task 1.1 must not
  // regress it.
  await page.setViewportSize({ width: 568, height: 320 });
  await openApp(page);
  const strip = await raiseMob(page);
  await expectMobActionsReachable(strip);
});

test('MOB actions stay reachable at 200-percent text', async ({ page }) => {
  // ACCESS-01 gate case, held behavior: rem-based layout doubles with the root font size, so this
  // simulates browser large-text faithfully, and a lone MOB strip stays reachable. Task 1.1 must
  // not regress it.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = '200%';
    });
  });
  await openApp(page);
  const strip = await raiseMob(page);
  await expectMobActionsReachable(strip);
});

test('full-screen Instruments keeps MOB initiation and response reachable', async ({ page }) => {
  // SAF-02: the full-screen dock carries an in-dialog MOB trigger, and an alarm-grade safety
  // event closes the modal outright so the emergency rail returns to the focus and reader path.
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Instrument dock', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Instruments' });
  await expect(dialog).toBeVisible();

  // The MOB trigger lives inside the modal focus scope, at full touch size.
  const trigger = dialog.getByRole('button', { name: 'Mark man overboard here' });
  await expect(trigger).toBeVisible();
  const triggerBox = await trigger.boundingBox();
  if (!triggerBox) throw new Error('MOB trigger did not lay out');
  expect(triggerBox.height).toBeGreaterThanOrEqual(44);

  // A raised MOB closes the modal, and the rail's response actions become reachable.
  await sendDelta(page, [MOB_ALARM]);
  const strip = page.getByRole('complementary', { name: 'Man overboard' });
  await expect(strip).toBeVisible();
  await expect(dialog).toBeHidden();
  await expectMobActionsReachable(strip);
});

test('safe-area insets keep the safety strips clear of system chrome', async ({ page }) => {
  // Held behavior: the status strip absorbs the bottom safe-area inset, which keeps the chart
  // host and its safety strips above system chrome. Task 1.1 must keep the emergency rail clear
  // too. Skips when this Chromium cannot override safe-area insets.
  await page.setViewportSize({ width: 320, height: 568 });
  // Shipped in recent Chromium for DevTools device emulation; not yet in Playwright's typings.
  const session = (await page.context().newCDPSession(page)) as unknown as {
    send(method: string, params?: object): Promise<unknown>;
  };
  let overrideWorks = false;
  try {
    await session.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 0, left: 0, right: 0, bottom: 48 },
    });
    overrideWorks = true;
  } catch {
    overrideWorks = false;
  }
  test.skip(!overrideWorks, 'this Chromium does not support Emulation.setSafeAreaInsetsOverride');

  await openApp(page);
  const probe = await page.evaluate(() => {
    const element = document.createElement('div');
    element.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
    document.body.append(element);
    const inset = getComputedStyle(element).paddingBottom;
    element.remove();
    return inset;
  });
  test.skip(probe === '0px', 'safe-area override did not reach env()');

  const strip = await raiseMob(page);
  const box = await strip.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('MOB strip did not lay out');
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 48);
});

test('stale GPS stops presenting coordinates as a current position', async ({ page }) => {
  // DATA-01: a retained fix relabels as "Last fix" with its age. The staleness window runs in
  // real time because the worker stamps delta receipt with its own clock, which a page-side fake
  // clock cannot reach.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  // The cluster, not a label-filtered readout: the label itself is what the fix changes.
  const cluster = page.locator('.center-cluster');
  await expect(cluster).toContainText('Vessel');
  await expect(cluster).toContainText('27.7000');

  // No further fixes: the vessel staleness window (10 seconds) elapses in real time.
  await expect(cluster).toContainText(/Last fix/, { timeout: 20_000 });
  await expect(cluster).toContainText(/ago/);
  await expect(cluster).not.toContainText('Vessel');
});

test('a server staleness declaration relabels the fix and names the quiet source', async ({
  page,
}) => {
  // Server-declared staleness is push-based, so unlike the client-window cases above nothing here
  // waits out a timeout: the declaration lands and the surfaces react at once.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  const cluster = page.locator('.center-cluster');
  await expect(cluster).toContainText('Vessel');

  await sendDelta(
    page,
    [
      staleValue('navigation.position', { latitude: 27.7, longitude: -82.7 }),
      staleValue('navigation.speedOverGround', 3),
    ],
    undefined,
    'gps0.GP',
  );
  // The strip relabels immediately: the retained fix presents as Last fix with an age, never as a
  // current position.
  await expect(cluster).toContainText(/Last fix/, { timeout: 5_000 });
  await expect(cluster).not.toContainText('Vessel');

  // The instrument detail names the declaration and the source that went quiet, not "Unknown".
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Instrument dock', exact: true })
    .click();
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await dock.getByRole('button', { name: /speed/i }).first().click();
  await expect(dock).toContainText('Stale (server declared)');
  await expect(dock).toContainText('No update from gps0.GP.');
});

test('stale wind angle is not presented as live beside fresh speed', async ({ page }) => {
  // DATA-02: the wind angle grades on its own epoch, so a retained angle beside fresh speed reads
  // "angle stale" and drops the needle. Real waits for the same reason as the stale-GPS case.
  await page.setViewportSize({ width: 1024, height: 768 });
  await openApp(page);
  await sendDelta(page, [
    ...OWN_FIX,
    { path: 'environment.wind.speedApparent', value: 6 },
    { path: 'environment.wind.angleApparent', value: 0.8 },
  ]);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Instrument dock', exact: true })
    .click();
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  const tile = dock.getByRole('button', { name: /wind/i }).first();
  await expect(tile).toBeVisible();

  // Fresh speed keeps arriving while the angle stops, until the angle cell passes its window.
  for (let tick = 0; tick < 7; tick += 1) {
    await page.waitForTimeout(2_000);
    await sendDelta(page, [{ path: 'environment.wind.speedApparent', value: 6 + tick * 0.1 }]);
  }
  await expect(tile).toHaveAttribute('aria-label', /angle (stale|unavailable)/i);
});

test('route editing stays visible with its exit actions when its panel is replaced', async ({
  page,
}) => {
  // NAV-01: the persistent route-edit strip keeps the mode, count, and exit actions visible even
  // after another panel replaces the Routes panel, so editing can never continue invisibly.
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Routes', exact: true })
    .click();
  await page.getByRole('button', { name: 'New route' }).click();
  const strip = page.getByRole('complementary', { name: 'Route editing' });
  await expect(strip).toBeVisible();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Waypoints', exact: true })
    .click();
  await expect(strip).toBeVisible();
  await expectActionReachable(strip.getByRole('button', { name: 'Open editor' }));
  const cancel = strip.getByRole('button', { name: 'Cancel' });
  await expectActionReachable(cancel);

  // The armed cancel ends the edit and the mode strip leaves with it.
  await cancel.click();
  await strip.getByRole('button', { name: 'Confirm cancel?' }).click();
  await expect(strip).toBeHidden();
});

test('the first-run orientation is offered once, opens Help, and never nags again', async ({
  page,
}) => {
  // HELP-01: a compact banner (never a forced panel) invites the safety orientation after the
  // shell is usable; the Help panel carries the advisory boundary, the chart distinction, and the
  // glossary; dismissal persists on the device.
  await page.setViewportSize({ width: 360, height: 800 });
  await openApp(page);
  const banner = page.getByText('First time with Binnacle?');
  await expect(banner).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Open Help' }).click();
  const help = page.getByRole('complementary', { name: 'Help and helm setup' });
  await expect(help).toBeVisible();
  await expect(help.getByText('advisory chartplotter', { exact: false })).toBeVisible();
  await expect(help.getByText('not a navigation chart', { exact: false })).toBeVisible();
  await expect(help.getByText('Closest point of approach', { exact: false }).first()).toBeVisible();

  await help.getByRole('button', { name: 'Got it, do not show this again' }).click();
  await help.getByRole('button', { name: 'Close help' }).click();
  await expect(banner).toBeHidden();

  // Dismissal persists on the device across a reload.
  await page.reload();
  await expect(page.locator('.status-strip .conn')).toHaveAttribute('title', /Connected/, {
    timeout: 20_000,
  });
  await expect(page.getByText('First time with Binnacle?')).toBeHidden();
});

test('emergency layout passes axe and the MOB actions are keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  const strip = await raiseMob(page);

  const steer = strip.getByRole('button', { name: 'Steer to MOB' });
  let reached = false;
  for (let presses = 0; presses < 60; presses += 1) {
    await page.keyboard.press('Tab');
    if (await steer.evaluate((element) => element === document.activeElement)) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
});

test('orientation falls back to north on a stale reference and survives a manual pan', async ({
  page,
}) => {
  await openApp(page);
  await sendDelta(page, OWN_FIX);

  // The orientation tile cycles north to course to heading; the menu closes on each select.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: /Orientation North up/ }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: /Orientation Course up/ }).click();

  const chip = page.locator('.status-strip .orientation-chip');
  await sendDelta(page, OWN_FIX);
  await expect(chip).toContainText('Heading up (true)');

  // The reference stops arriving: the vessel staleness window elapses and the chart states its
  // immediate fallback to north rather than holding a dead rotation.
  await expect(chip).toContainText('North up (true heading stale)', { timeout: 20_000 });

  // A manual pan releases Follow elsewhere but must not corrupt the orientation state.
  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('map canvas did not lay out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(chip).toContainText('North up (true heading stale)');

  // One tap returns to north-up, and the chip retires with the mode.
  await chip.getByRole('button', { name: 'N up' }).click();
  await expect(chip).toHaveCount(0);
});

test('watch handoff keeps an offline snapshot on the device and says so', async ({ page }) => {
  await openApp(page);
  await sendDelta(page, OWN_FIX);

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Watch handoff' }).click();
  const panel = page.getByRole('complementary', { name: 'Watch handoff' });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByText('It is never a statement that it is safe to take watch.'),
  ).toBeVisible();

  // The fixture server has no applicationData store, so the snapshot stays on this device.
  await panel
    .getByPlaceholder('Sea state, traffic, engine, anything to watch')
    .fill('Wind building.');
  await panel.getByRole('button', { name: 'Take handoff snapshot' }).click();
  await expect(panel.getByText('Wind building.')).toBeVisible();
  await expect(panel.getByText('On this device only')).toBeVisible();
  await expect(panel.getByText('GPS fix', { exact: true })).toBeVisible();
});
