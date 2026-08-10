import type { Map as MapLibreMap } from 'maplibre-gl';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnitsStore } from '$entities/units';
import type { UnitsMode } from '$shared/lib';
import type { PwaStatus } from '$shared/pwa';
import { PersistedValue } from '$shared/settings';
import { createFakeStorage, jsonResponse } from '$shared/testing';
import { canDownloadRegion, downloadGateReason } from './estimate.js';
import RegionsPanel from './RegionsPanel.svelte';
import type { CacheStats } from './regions-client.js';

// Pins the gate predicate the panel uses: Download is enabled only when a box is drawn, at least
// one source is selected, administrator access is available, and the estimate fits the regions-free
// budget.

const stats: CacheStats = {
  rows: 0,
  bytes: 0,
  cap: 1_000_000_000,
  regionsBudgetBytes: 500_000_000,
  regionsFreeBytes: 450_000_000,
  perSourceAvgBytes: { seamark: 20_000 },
};

describe('regions gate', () => {
  it('disabled with no box', () => {
    expect(
      canDownloadRegion({
        bbox: null,
        sources: ['seamark'],
        accessBlocked: false,
        stats,
        zoomRange: [6, 8],
      }),
    ).toBe(false);
  });

  it('disabled when administrator access is blocked', () => {
    expect(
      canDownloadRegion({
        bbox: [-1, -1, 1, 1],
        sources: ['seamark'],
        accessBlocked: true,
        stats,
        zoomRange: [6, 8],
      }),
    ).toBe(false);
  });

  it('disabled when the estimate exceeds the regions-free budget', () => {
    const tiny: CacheStats = { ...stats, regionsBudgetBytes: 1000, regionsFreeBytes: 1000 };
    expect(
      canDownloadRegion({
        bbox: [-5, -5, 5, 5],
        sources: ['seamark'],
        accessBlocked: false,
        stats: tiny,
        zoomRange: [6, 10],
      }),
    ).toBe(false);
  });

  it('enabled when a box and a source are set and the estimate fits', () => {
    expect(
      canDownloadRegion({
        bbox: [-0.1, -0.1, 0.1, 0.1],
        sources: ['seamark'],
        accessBlocked: false,
        stats,
        zoomRange: [6, 7],
      }),
    ).toBe(true);
  });

  it('disabled with no sources selected', () => {
    expect(
      canDownloadRegion({
        bbox: [-1, -1, 1, 1],
        sources: [],
        accessBlocked: false,
        stats,
        zoomRange: [6, 8],
      }),
    ).toBe(false);
  });
});

describe('download gate explanation', () => {
  it('reports administrator access before the chart workflow', () => {
    expect(
      downloadGateReason({
        bbox: null,
        sources: [],
        accessBlocked: true,
        stats: null,
        estimate: null,
      }),
    ).toBe('administrator-access');
  });

  it('reports the first workflow step that blocks the download', () => {
    expect(
      downloadGateReason({
        bbox: null,
        sources: [],
        accessBlocked: false,
        stats,
        estimate: 0,
      }),
    ).toBe('draw-area');
    expect(
      downloadGateReason({
        bbox: [-1, -1, 1, 1],
        sources: [],
        accessBlocked: false,
        stats,
        estimate: 0,
      }),
    ).toBe('choose-charts');
  });

  it('distinguishes storage loading and insufficient space', () => {
    expect(
      downloadGateReason({
        bbox: [-1, -1, 1, 1],
        sources: ['seamark'],
        accessBlocked: false,
        stats: null,
        estimate: 1,
      }),
    ).toBe('storage-loading');
    expect(
      downloadGateReason({
        bbox: [-1, -1, 1, 1],
        sources: ['seamark'],
        accessBlocked: false,
        stats: { ...stats, regionsFreeBytes: 10 },
        estimate: 11,
      }),
    ).toBe('insufficient-space');
  });

  it('reports an estimate validation failure', () => {
    expect(
      downloadGateReason({
        bbox: [-1, -1, 1, 1],
        sources: ['seamark'],
        accessBlocked: false,
        stats,
        estimate: null,
      }),
    ).toBe('estimate-error');
  });
});

describe('offline charts home view', () => {
  const PLAIN_HTTP_NOTE =
    "This server uses plain HTTP, so the browser's offline cache for the base map and streamed " +
    "chart tiles stays off. Charts you have already viewed still reopen offline from the browser's " +
    "own store, and Chart Locker's saved areas and automatic caching keep working over the boat " +
    'network. To cache everything, enable SSL on the Signal K server and trust its certificate.';

  const UNTRUSTED_CERTIFICATE_NOTE =
    "This browser does not trust the Signal K server's certificate, so the browser's offline " +
    'cache for the base map and streamed chart tiles stays off. Charts you have already viewed ' +
    "still reopen offline from the browser's own store, and Chart Locker's saved areas and " +
    'automatic caching keep working over the boat network. To cache everything, install the ' +
    "server certificate, or its certificate authority, in this device's trust store, mark it " +
    'trusted, and reload.';

  // The template wraps the note across source lines, so compare against collapsed whitespace.
  function renderHome(insecureTransport: boolean, pwaStatus: PwaStatus = 'pending'): string {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );
    return render(RegionsPanel, {
      props: {
        adminAccess: true,
        accessUrl: 'http://sk/admin',
        accessState: 'serving',
        companionBase: 'http://sk/chart-locker',
        map: {} as MapLibreMap,
        units: new UnitsStore(
          new PersistedValue<UnitsMode>('binnacle:units-test', 'metric', createFakeStorage()),
        ),
        insecureTransport,
        pwaStatus,
        onClose: () => {},
        onOpenCharts: () => {},
        onRetryAccess: () => {},
      },
    }).body.replaceAll(/\s+/g, ' ');
  }

  afterEach(() => vi.unstubAllGlobals());

  it('offers the route coverage check with its noncertifying copy while navigating', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );
    const html = render(RegionsPanel, {
      props: {
        adminAccess: true,
        accessUrl: 'http://sk/admin',
        accessState: 'serving',
        companionBase: 'http://sk/chart-locker',
        map: {} as MapLibreMap,
        units: new UnitsStore(
          new PersistedValue<UnitsMode>('binnacle:units-test', 'metric', createFakeStorage()),
        ),
        insecureTransport: false,
        activeRoute: () => ({
          name: 'Harbor passage',
          waypoints: [
            { position: { latitude: 0, longitude: 0 } },
            { position: { latitude: 0, longitude: 1 } },
          ],
        }),
        onClose: () => {},
        onOpenCharts: () => {},
        onRetryAccess: () => {},
      },
    }).body.replaceAll(/\s+/g, ' ');
    expect(html).toContain('Harbor passage');
    expect(html).toContain('it does not certify navigation or passage safety');
    expect(html).toContain('Check route coverage');
    expect(html).toContain('aria-label="Corridor width"');
    expect(html).toContain('aria-label="Required detail"');
  });

  it('invites starting navigation when no route is active', () => {
    expect(renderHome(false)).toContain(
      'Start navigation on a route to check its corridor against your saved areas.',
    );
  });

  it('explains what a plain HTTP server cannot cache', () => {
    expect(renderHome(true)).toContain(PLAIN_HTTP_NOTE);
  });

  it('stays quiet about transport when the server is reached over HTTPS', () => {
    expect(renderHome(false)).not.toContain(PLAIN_HTTP_NOTE);
  });

  it('explains an untrusted server certificate keeping the browser cache off', () => {
    expect(renderHome(false, 'untrusted-certificate')).toContain(UNTRUSTED_CERTIFICATE_NOTE);
  });

  it('stays quiet about the certificate while registration is healthy', () => {
    expect(renderHome(false, 'active')).not.toContain(UNTRUSTED_CERTIFICATE_NOTE);
  });

  it('lets the plain HTTP notice outrank the certificate one when both conditions hold', () => {
    // Plain HTTP is the actionable root cause there; a certificate note beside it would send the
    // navigator chasing a trust store that cannot help until SSL is on at all.
    const body = renderHome(true, 'untrusted-certificate');
    expect(body).toContain(PLAIN_HTTP_NOTE);
    expect(body).not.toContain(UNTRUSTED_CERTIFICATE_NOTE);
  });

  it('explains a failed registration keeping the browser cache off', () => {
    expect(renderHome(false, 'failed')).toContain('could not start');
  });

  // The region has to be mounted and empty before draw mode starts, or the instruction it later
  // carries is inserted rather than changed and screen readers skip it.
  it('keeps a polite live region mounted for the draw-mode instruction', () => {
    expect(renderHome(false)).toContain('<p class="visually-hidden" aria-live="polite">');
  });
});

it('persists position-warm settings through postConfig', async () => {
  const posted: unknown[] = [];
  const client = {
    getConfig: async () => ({
      bbox: null,
      sources: [],
      minzoom: 6,
      maxzoom: 12,
      positionWarm: {
        enabled: false,
        radiusMeters: 3704,
        moveThresholdMeters: 1852,
        intervalSecs: 60,
        baseZoom: 12,
        sources: [],
      },
    }),
    postConfig: async (c: unknown) => {
      posted.push(c);
    },
  };
  const { buildConfigPayload } = await import('./settings-payload.js');
  const payload = buildConfigPayload({
    enabled: true,
    radiusMeters: 5556,
    moveThresholdMeters: 1852,
    intervalSecs: 120,
    baseZoom: 13,
    sources: ['seamark'],
  });
  await client.postConfig(payload);
  expect(posted[0]).toMatchObject({
    positionWarm: { enabled: true, radiusMeters: 5556, intervalSecs: 120 },
  });
});
