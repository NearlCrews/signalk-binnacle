import { describe, expect, it } from 'vitest';
import { canDownloadRegion, downloadGateReason } from './estimate.js';
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
