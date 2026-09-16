import { describe, expect, it } from 'vitest';
import { formatTideDatum, formatTideEventTime, tideHandoffFact } from './tide-confidence';
import { TidesStore } from './tides-store.svelte';

const station = { id: 'T1', name: 'Accepted station', latitude: 50, longitude: -1 };

describe('tide confidence presentation', () => {
  it('preserves verified datum and leaves a legacy reference unknown', () => {
    expect(formatTideDatum({ datum: 'LAT' })).toBe('Datum: LAT');
    expect(formatTideDatum({})).toBe('Datum unknown');
    expect(formatTideDatum(undefined)).toBe('Datum unknown');
    expect(formatTideEventTime(Date.UTC(2026, 8, 17, 12))).toContain('Sep');
  });

  it('keeps failure and source-age qualifiers before long station names', () => {
    const store = new TidesStore();
    store.setReadings(
      { station, distanceMeters: 0, events: [], datum: 'LAT' },
      undefined,
      'signalk-tides',
    );
    store.requestManual('tide', { ...station, id: 'T2', name: 'Requested station '.repeat(8) }, 10);
    store.applyLoad({
      tide: { state: 'failed', selection: store.requestedTide },
      current: { state: 'no-coverage', selection: { mode: 'automatic' } },
    });
    const text = tideHandoffFact(store, Date.UTC(2026, 8, 16));
    expect(text.slice(0, 200)).toContain(
      'Retained; tide refresh failed; fetch time unknown; Datum: LAT',
    );
    expect(text).toContain('accepted Accepted station');
    expect(text).toContain('Requested station');
  });

  it('does not renew the fetch timestamp of retained predictions', () => {
    const store = new TidesStore();
    const fetchedAtMs = Date.UTC(2026, 8, 14, 12);
    store.setReadings(
      { station, distanceMeters: 0, events: [], fetchedAtMs },
      undefined,
      'signalk-tides',
    );
    expect(tideHandoffFact(store, fetchedAtMs + 86_400_000)).toContain(
      `fetched ${formatTideEventTime(fetchedAtMs)}`,
    );
    expect(tideHandoffFact(store, fetchedAtMs - 1)).toContain('fetch time unknown');
  });

  it('qualifies current-only coverage separately from missing heights', () => {
    const store = new TidesStore();
    store.setReadings(undefined, { station, distanceMeters: 0, events: [] });
    expect(tideHandoffFact(store, Date.now())).toContain(
      'tide height unavailable; NOAA CO-OPS current station',
    );
  });
});
