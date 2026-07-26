import { expect, type Page, type Request, type Response } from '@playwright/test';

const LIBERTY_STYLE_URL = /^https:\/\/tiles\.openfreemap\.org\/styles\/liberty\/?(?:\?.*)?$/;
const WORKER_ASSET_PATH = '/assets/maplibre-gl-worker-';
const BASE_STYLE_FALLBACK_MESSAGES = [
  '[map] the base map style did not arrive; starting on the offline fallback base.',
  '[map] the base map style is unreachable; starting on the offline fallback base.',
] as const;

const WORKER_PROOF_STYLE = {
  version: 8,
  name: 'binnacle-maplibre-worker-proof',
  sources: {
    'worker-proof': {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Point',
              coordinates: [0, 30],
            },
          },
        ],
      },
    },
  },
  layers: [
    {
      id: 'worker-proof',
      type: 'circle',
      source: 'worker-proof',
      paint: {
        'circle-color': '#ffbf00',
        'circle-radius': 4,
      },
    },
  ],
};

function isWorkerAssetUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes(WORKER_ASSET_PATH);
  } catch {
    return false;
  }
}

function failedRequestSummary(request: Request): string {
  const failure = request.failure();
  return failure ? `${request.url()}: ${failure.errorText}` : request.url();
}

export interface MapLibreWorkerProof {
  assertInitialNavigation: () => Promise<string>;
}

export async function installMapLibreWorkerProof(page: Page): Promise<MapLibreWorkerProof> {
  const pageErrors: string[] = [];
  const failedWorkerRequests: string[] = [];
  const fallbackMessages: string[] = [];
  let styleFulfillments = 0;

  page.on('pageerror', (error) => {
    pageErrors.push(error.stack ?? error.message);
  });
  page.on('requestfailed', (request) => {
    if (isWorkerAssetUrl(request.url())) failedWorkerRequests.push(failedRequestSummary(request));
  });
  page.on('console', (message) => {
    const text = message.text();
    if (BASE_STYLE_FALLBACK_MESSAGES.some((fallback) => text.includes(fallback))) {
      fallbackMessages.push(text);
    }
  });

  await page.route(LIBERTY_STYLE_URL, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify(WORKER_PROOF_STYLE),
    });
    styleFulfillments += 1;
  });

  const workerResponsePromise = page.waitForResponse((response) =>
    isWorkerAssetUrl(response.url()),
  );

  return {
    assertInitialNavigation: async () => {
      const workerResponse: Response = await workerResponsePromise;
      await expect
        .poll(() => styleFulfillments, {
          message: 'the deterministic Liberty style route should be fulfilled exactly once',
        })
        .toBe(1);
      expect(workerResponse.status()).toBe(200);
      expect(workerResponse.ok()).toBe(true);
      expect(workerResponse.headers()['content-type']).toMatch(/(?:java|ecma)script/i);
      expect(pageErrors, 'page errors during MapLibre initialization').toEqual([]);
      expect(failedWorkerRequests, 'failed MapLibre worker requests').toEqual([]);
      expect(fallbackMessages, 'unexpected base-style fallback messages').toEqual([]);
      return workerResponse.url();
    },
  };
}
