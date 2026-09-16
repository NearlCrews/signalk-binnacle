import { deflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';
import { stubVesselsSelf } from './helpers';

const ARCHIVE_PATH = '/test-chart.pmtiles';
const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

// A real, decodable 256 px raster tile, with no external chart or vessel data.
function chartPng(version: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0);
  header.writeUInt32BE(256, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc(256 * (1 + 256 * 3));
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const pixel = y * 769 + 1 + x * 3;
      rows[pixel] = version === 1 ? 35 : 90;
      rows[pixel + 1] = 110;
      rows[pixel + 2] = 150;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function varint(value: number): number[] {
  const result: number[] = [];
  while (value > 127) {
    result.push((value % 128) | 128);
    value = Math.floor(value / 128);
  }
  result.push(value);
  return result;
}

// PMTiles v3, one repeated tile spanning zooms 0..14. Put tile bytes in block 1 so loading a
// TileJSON/header alone cannot satisfy the offline test. Directory and metadata stay in block 0.
function fixtureArchive(version = 1): Buffer {
  const tile = chartPng(version);
  const addressed = (4 ** 15 - 1) / 3;
  const directory = Buffer.from([1, 0, ...varint(addressed), ...varint(tile.length), 1]);
  const metadata = Buffer.from(JSON.stringify({ name: 'Offline fixture', format: 'png' }));
  const archive = Buffer.alloc(65536 + tile.length);
  archive.write('PMTiles');
  archive[7] = 3;
  for (const [offset, value] of [
    [8, 127],
    [16, directory.length],
    [24, 127 + directory.length],
    [32, metadata.length],
    [56, 65536],
    [64, tile.length],
    [72, addressed],
    [80, 1],
    [88, 1],
  ]) {
    archive.writeBigUInt64LE(BigInt(value), offset);
  }
  archive[96] = 1;
  archive[97] = 1;
  archive[98] = 1;
  archive[99] = 2;
  archive[101] = 14;
  archive.writeInt32LE(-1800000000, 102);
  archive.writeInt32LE(-850000000, 106);
  archive.writeInt32LE(1800000000, 110);
  archive.writeInt32LE(850000000, 114);
  directory.copy(archive, 127);
  metadata.copy(archive, 127 + directory.length);
  tile.copy(archive, 65536);
  return archive;
}

export async function installChartFixture(page: Page) {
  const state = {
    version: 1,
    offline: false,
    baseOffline: false,
    failTiles: false,
    requests: [] as number[],
  };
  await stubVesselsSelf(page);
  await page.addInitScript(() => {
    localStorage.setItem('binnacle:help-orientation', 'true');
    localStorage.setItem('binnacle:theme', 'day');
  });
  // Context routing also intercepts the service worker's revalidation request. Page routing
  // only covers the initial, uncontrolled load and leaves the real style uncached for offline.
  await page.context().route(/^https:\/\/tiles\.openfreemap\.org\/styles\/liberty/, (route) => {
    if (state.baseOffline) return route.abort('internetdisconnected');
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [{ id: 'base', type: 'background', paint: { 'background-color': '#ddd' } }],
      }),
    });
  });
  await page.route(/\/signalk\/v[12]\/api\/resources\/charts\/?$/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        fixture: {
          identifier: 'fixture',
          name: 'Offline fixture',
          type: 'tilelayer',
          format: 'png',
          url: new URL(ARCHIVE_PATH, route.request().url()).href,
          minzoom: 0,
          maxzoom: 14,
        },
      }),
    }),
  );
  await page.route(`**${ARCHIVE_PATH}`, (route) => {
    const [start, requestedEnd] = (
      route.request().headers().range?.match(/\d+/g) ?? ['0', '65535']
    ).map(Number);
    state.requests.push(start);
    if (state.offline) return route.abort('internetdisconnected');
    if (state.failTiles && start >= 65536) return route.fulfill({ status: 503 });
    const archive = fixtureArchive(state.version);
    const end = Math.min(requestedEnd, archive.length - 1);
    return route.fulfill({
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${archive.length}`,
        ETag: `"fixture-v${state.version}"`,
        'Cache-Control': 'no-store',
      },
      body: archive.subarray(start, end + 1),
    });
  });
  return state;
}

export async function expectFixtureChart(page: Page, version = 1): Promise<void> {
  await expect(page.locator('.chart-status')).toHaveText('Chart', { timeout: 30_000 });
  const canvas = page.locator('.maplibregl-canvas').first();
  await expect(canvas).toBeVisible();
  // A source can have a GPU texture without contributing visible pixels. Decode a screenshot
  // of the composited canvas so the assertion also proves this generation's raster was drawn.
  await expect
    .poll(
      async () => {
        const screenshot = await canvas.screenshot();
        return page.evaluate(
          async ({ bytes, red }) => {
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
            );
            const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = surface.getContext('2d');
            if (!context) throw new Error('Could not decode the chart screenshot');
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
            let matching = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              if (
                Math.abs(pixels[i] - red) <= 3 &&
                Math.abs(pixels[i + 1] - 110) <= 3 &&
                Math.abs(pixels[i + 2] - 150) <= 3
              )
                matching++;
            }
            return matching / (surface.width * surface.height);
          },
          { bytes: [...screenshot], red: version === 1 ? 35 : 90 },
        );
      },
      { message: 'the fixture chart pixels should be drawn in the current viewport' },
    )
    .toBeGreaterThan(0.1);
}

export async function warmFixtureBaseStyle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await page.evaluate(async (url) => {
    await fetch(url);
  }, BASE_STYLE_URL);
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        const cache = await caches.open('binnacle-basemap-style');
        return (await cache.match(url))?.ok ?? false;
      }, BASE_STYLE_URL),
    )
    .toBe(true);
}

export async function cachedArchive(page: Page): Promise<{ validator?: string; blocks: number[] }> {
  return page.evaluate(async (path) => {
    const url = new URL(path, location.href).href;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('binnacle-pmtiles-blocks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(['archives', 'blocks'], 'readonly');
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const [validator, keys] = await Promise.all([
        read(tx.objectStore('archives').get(url)),
        read(tx.objectStore('blocks').getAllKeys()),
      ]);
      return {
        validator,
        blocks: keys
          .map(String)
          .filter((key) => key.startsWith(`${url}\n`))
          .map((key) => Number(key.split('\n')[1])),
      };
    } finally {
      db.close();
    }
  }, ARCHIVE_PATH);
}
