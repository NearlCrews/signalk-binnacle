import { describe, expect, it, vi } from 'vitest';
import type { OverlayContext } from '$shared/map';
import { SK_PATHS } from '$shared/signalk';
import { createFakeMap, sourceFeatures } from '$shared/testing';
import { createHistoryTrackOverlay } from './history-track-overlay';

describe('createHistoryTrackOverlay', () => {
  it('splits a historical track crossing the antimeridian', async () => {
    const fetchValues = vi.fn(async () => ({
      provider: 'history',
      values: {
        from: '2026-06-08T00:00:00Z',
        to: '2026-06-08T00:01:00Z',
        columns: [{ path: SK_PATHS.position, method: '' }],
        rows: [
          ['2026-06-08T00:00:00Z', { latitude: 10, longitude: 179 }],
          ['2026-06-08T00:01:00Z', { latitude: 12, longitude: -179 }],
        ] as const,
      },
    }));
    const overlay = createHistoryTrackOverlay(
      'http://sk',
      () => 'token',
      () => ({ ids: ['history'] }),
      { fetchValues, now: () => 1 },
    );
    const map = createFakeMap();
    const context: OverlayContext = { map: map as never, beforeIdFor: () => undefined };
    overlay.add(context);

    overlay.sync(context);

    await vi.waitFor(() =>
      expect(sourceFeatures(map, 'binnacle-track-history')[0]?.geometry).toEqual({
        type: 'MultiLineString',
        coordinates: [
          [
            [179, 10],
            [180, 11],
          ],
          [
            [-180, 11],
            [-179, 12],
          ],
        ],
      }),
    );
  });
});
