import { afterEach, describe, expect, it, vi } from 'vitest';
import { TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import type { UnitsMode } from '$shared/lib';
import type { OverlayContext } from '$shared/map';
import { createFakeMap, sourceFeatures } from '$shared/testing/fake-map';
import { createTidesOverlay } from './tides-overlay';

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

function unitsStub(mode: UnitsMode = 'metric'): { mode: UnitsMode } {
  return { mode };
}

const station = { id: 'T1', name: 'Tide', latitude: 27.7, longitude: -82.7 };

afterEach(() => {
  vi.useRealTimers();
});

describe('tides overlay', () => {
  it('refreshes the marker label when the minute turns over', () => {
    vi.useFakeTimers();
    const t0 = Date.UTC(2026, 5, 8, 12, 0, 30);
    vi.setSystemTime(t0);
    const store = new TidesStore();
    store.setReadings(
      {
        station,
        distanceMeters: 1000,
        events: [
          { timeMs: t0 + 45_000, heightMeters: 0.5, kind: 'high' },
          { timeMs: t0 + 6 * 60 * 60 * 1000, heightMeters: 0.1, kind: 'low' },
        ],
      },
      undefined,
    );
    const units = unitsStub();
    const overlay = createTidesOverlay(store, units as unknown as UnitsStore);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.sync(ctx);
    const label = () =>
      sourceFeatures<{ properties: { label: string } }>(map, 'binnacle-tides')[0].properties.label;
    expect(label()).toContain('High');
    const before = map.sources.get('binnacle-tides')?.data;
    overlay.sync(ctx); // same minute, same readings, same units: no rebuild
    expect(map.sources.get('binnacle-tides')?.data).toBe(before);
    units.mode = 'imperial'; // a preference flip refreshes the labels within the minute
    overlay.sync(ctx);
    expect(label()).toContain('ft');
    vi.setSystemTime(t0 + 60_000); // the next minute, with the high now in the past
    overlay.sync(ctx);
    expect(label()).toContain('Low');
  });

  it('dims the circle stroke along with the rest of the layer opacity', () => {
    const overlay = createTidesOverlay(new TidesStore(), unitsStub() as unknown as UnitsStore);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.setOpacity?.(ctx, 0.4);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-tides-circle',
      'circle-stroke-opacity',
      0.4,
    );
  });
});
