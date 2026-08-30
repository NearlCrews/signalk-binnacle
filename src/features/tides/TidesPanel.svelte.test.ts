import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { TideStationSelection } from '$entities/tides';
import { TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import { METRIC_UNITS } from '$shared/lib';
import TidesPanel from './TidesPanel.svelte';
import type { TidesController } from './tides-controller.svelte';

const tideStation = { id: 'T1', name: 'Harbor tide', latitude: 27.7, longitude: -82.7 };
const otherTide = { id: 'T2', name: 'Pass tide', latitude: 27.8, longitude: -82.8 };
const currentStation = {
  id: 'C1',
  name: 'Channel current',
  latitude: 27.71,
  longitude: -82.71,
};
const automatic: TideStationSelection = { mode: 'automatic' };

function controller(): TidesController {
  return {
    load: vi.fn(async () => undefined),
    loadCurrent: vi.fn(async () => undefined),
    selectStation: vi.fn(async () => undefined),
    useAutomatic: vi.fn(async () => undefined),
    useNearestStations: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
}

function renderPanel(store: TidesStore): string {
  return render(TidesPanel, {
    props: {
      store,
      controller: controller(),
      units: { mode: 'metric', profile: METRIC_UNITS } as UnitsStore,
      onClose: vi.fn(),
    },
  }).body.replaceAll(/\s+/g, ' ');
}

describe('TidesPanel', () => {
  it('renders independent grouped native station buttons with distances and active choices', () => {
    const store = new TidesStore();
    store.setCatalogs(
      [
        { station: tideStation, distanceMeters: 1200 },
        { station: otherTide, distanceMeters: 12_000 },
      ],
      [{ station: currentStation, distanceMeters: 2500 }],
    );
    store.requestManual('tide', otherTide, 12_000);

    const body = renderPanel(store);

    expect(body).toContain('aria-label="Station selection"');
    expect(body).toContain('id="tide-stations-heading"');
    expect(body).toContain('id="current-stations-heading"');
    expect(body).toContain('<button');
    expect(body).toContain('Pass tide');
    expect(body).toContain('12 km straight-line');
    expect(body).toMatch(/aria-current="true"[^>]*><span class="nav-name">Pass tide/);
    expect(body).toContain('Use nearest stations');
    expect(body).toContain('Automatic, nearest available');
  });

  it('explains manual NOAA selection, straight-line limits, and valid empty windows', () => {
    const store = new TidesStore();
    store.requestManual('tide', tideStation, 1000);
    store.requestManual('current', currentStation, 2000);
    store.applyLoad({
      tide: {
        state: 'accepted',
        reading: { station: tideStation, distanceMeters: 1000, events: [] },
        source: 'noaa-coops',
        selection: store.requestedTide,
      },
      current: {
        state: 'accepted',
        reading: { station: currentStation, distanceMeters: 2000, events: [] },
        selection: store.requestedCurrent,
      },
    });

    const body = renderPanel(store);

    expect(body).toContain('Manual choices use NOAA CO-OPS and stay selected while you pan.');
    expect(body).toContain('do not guarantee that a station represents local water movement');
    expect(body.match(/No predictions in this window\./g)).toHaveLength(2);
    expect(body).toContain('manually selected tide station');
    expect(body).toContain('mean lower low water (MLLW)');
    expect(body).toContain("device's local time");
  });

  it('names a failed requested station, retains the accepted reading, and offers Retry', () => {
    const store = new TidesStore();
    store.setReadings(
      {
        station: tideStation,
        distanceMeters: 1000,
        events: [{ timeMs: Date.now() + 1000, heightMeters: 0.2, kind: 'high' }],
      },
      undefined,
      'noaa-coops',
    );
    store.requestManual('tide', otherTide, 12_000);
    store.applyLoad({
      tide: { state: 'failed', selection: store.requestedTide },
      current: { state: 'no-coverage', selection: automatic },
    });

    const body = renderPanel(store);

    expect(body).toContain(
      'Pass tide did not load. Showing the last accepted reading from Harbor tide.',
    );
    expect(body).toContain('Retry');
    expect(body).toContain('Harbor tide');
  });
});
