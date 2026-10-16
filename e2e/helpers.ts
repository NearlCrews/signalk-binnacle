import { expect, type Locator, type Page } from '@playwright/test';

// Shared browser-test helpers. A spec's file-local helper is invisible to the other specs, so
// each one re-rolled the same stubs and the same menu walk inline; when a menu label or a route
// shape changes, one shared edit keeps the cases consistent.

// The self-vessel document. Binnacle probes it on boot to learn its own context, and every spec
// needs it to answer something rather than hang on a real server that is not running.
export async function stubVesselsSelf(page: Page): Promise<void> {
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

// The visible stream phase proves the socket opened. Do not infer readiness from a tooltip or
// from the shell being mounted: a one-shot fixture delta sent while connecting is lost.
export async function waitForSignalKConnection(page: Page): Promise<void> {
  await expect(page.locator('.status-strip .conn-live')).toHaveText('Connected', {
    timeout: 20_000,
  });
}

// Open the app menu and activate one of its tiles. Scoped to the launcher, because a menu label
// usually also names a bar pill or a panel heading, and an unscoped match picks whichever the DOM
// happens to hold first.
export async function openMenuItem(page: Page, itemName: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: itemName, exact: typeof itemName === 'string' })
    .click();
}

// The stream fixture's port and origins, in one place: playwright.config.ts starts the server
// with this port, the mariner project navigates the app origin, and the spec drives the control
// channel at the server root, so the three cannot desync.
export const FIXTURE_PORT = 4174;
export const FIXTURE_SERVER = `http://127.0.0.1:${FIXTURE_PORT}`;
export const FIXTURE_ORIGIN = `${FIXTURE_SERVER}/signalk-binnacle/`;

// Assert an element does not scroll horizontally. The one-pixel tolerance absorbs subpixel
// rounding on fractional layouts, and the poll absorbs a layout that has not settled yet;
// seventeen inline copies of this check drifted on exactly those two points.
export async function expectNoHorizontalOverflow(surface: Locator): Promise<void> {
  await expect
    .poll(() => surface.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
}

// Assert a floating surface lies inside the viewport it was measured in. Measures the live document
// rather than restating pixels, so a spec that sets its own viewport cannot leave a stale bound
// asserting against a size the page no longer has. clientWidth and clientHeight, not viewportSize:
// they exclude a scrollbar, which a surface pinned to the trailing edge sits inside of.
// A laid-out element's box, failing loudly rather than reading a missing box as zero.
export async function requireBox(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected a laid-out element');
  return box;
}

// Scale the root font before the app boots, the way an enlarged text setting does.
export async function setRootFontSize(page: Page, percent: number): Promise<void> {
  await page.addInitScript((value) => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${value}%`;
    });
  }, percent);
}

export async function expectInsideViewport(surface: Locator, page: Page): Promise<void> {
  await expect(surface).toBeVisible();
  await expect
    .poll(async () => {
      const [box, viewport] = await Promise.all([
        surface.boundingBox(),
        page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        })),
      ]);
      if (!box) return 'Surface is still laying out';
      if (
        box.x < 0 ||
        box.y < 0 ||
        box.x + box.width > viewport.width ||
        box.y + box.height > viewport.height
      ) {
        return `Surface ${JSON.stringify(box)} exceeds viewport ${JSON.stringify(viewport)}`;
      }
      return null;
    })
    .toBeNull();
}

// Safety chrome and its touch-lock holes update through layout observers. Visibility alone can
// precede that update, so require the real 44 px hit target with the normal bounded expectation.
export async function expectHelmHitTarget(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        if (box.width < 44 || box.height < 44) {
          return `Target is ${box.width} by ${box.height} CSS px; at least 44 by 44 required`;
        }
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit !== null && element.contains(hit)
          ? null
          : `Target center hits ${hit?.outerHTML.slice(0, 500) ?? 'nothing'}`;
      }),
    )
    .toBeNull();
}

// Measure rendered text contrast against the composited ancestor surfaces. This is intentionally
// browser-side so color-mix(), theme variables, and the real cascade are all resolved before the
// WCAG relative-luminance calculation runs.
export async function contrastRatio(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('A 2D canvas is required to resolve rendered colors.');
    const rgba = (value: string): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, alpha / 255];
    };
    const over = (
      front: [number, number, number, number],
      back: [number, number, number, number],
    ): [number, number, number, number] => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      const channel = (index: number) =>
        (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha;
      return [channel(0), channel(1), channel(2), alpha];
    };
    const luminance = ([r, g, b]: [number, number, number, number]) => {
      const linear = [r, g, b].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    let background: [number, number, number, number] = [0, 0, 0, 0];
    for (let node: Element | null = element; node; node = node.parentElement) {
      background = over(background, rgba(getComputedStyle(node).backgroundColor));
      if (background[3] >= 0.99) break;
    }
    background = over(background, [255, 255, 255, 1]);
    const foreground = over(rgba(getComputedStyle(element).color), background);
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return (light + 0.05) / (dark + 0.05);
  });
}

// The share of a PNG's pixels within `tolerance` of one RGB color, decoded in the page. Proves a
// canvas actually painted a color rather than that a style merely asked for it.
export async function colorShare(
  page: Page,
  png: Buffer,
  rgb: readonly [number, number, number],
  tolerance = 3,
): Promise<number> {
  return page.evaluate(
    async ({ bytes, rgb: [red, green, blue], tolerance: within }) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      );
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext('2d');
      if (!context) throw new Error('Could not decode the screenshot');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
      let matching = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          Math.abs(pixels[i] - red) <= within &&
          Math.abs(pixels[i + 1] - green) <= within &&
          Math.abs(pixels[i + 2] - blue) <= within
        )
          matching++;
      }
      return matching / (surface.width * surface.height);
    },
    { bytes: [...png], rgb, tolerance },
  );
}

// The active starter profile applies its own theme on boot, so switch through the toolbar button,
// which cycles day, dusk, and night-red.
export async function switchToTheme(
  page: Page,
  theme: 'day' | 'dusk' | 'night-red',
): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) === theme) break;
    await page.getByRole('button', { name: /^Switch theme/ }).click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

// Counts pixels that carry blue or read as neutral gray. Antialiased red on black stays red, so
// the blue rule has a small tolerance for compression noise only.
export async function nightRedOffendingPixels(page: Page, png: Buffer): Promise<string[]> {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    const bad: string[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      const blue = b > 12;
      const gray = r > 24 && Math.abs(r - g) < 12 && Math.abs(r - b) < 12;
      if ((blue || gray) && bad.length < 10) {
        const pixel = i / 4;
        bad.push(`${pixel % image.width},${Math.floor(pixel / image.width)} rgb(${r} ${g} ${b})`);
      }
    }
    return bad;
  }, png.toString('base64'));
}
