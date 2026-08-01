import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubFetch } from '$shared/testing';
import { fetchSignalkTidesReading, parseTidesResource } from './signalk-tides-client';

const NOW_MS = Date.UTC(2026, 5, 8, 12, 0);

// This file's calls read json-first, which suits a client whose responses are all one body; the
// stubbing itself is the shared helper's.
const mockFetch = (json: unknown, ok = true, status = 200) => stubFetch({ body: json, ok, status });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseTidesResource', () => {
  it('parses the 1.x shape: type and value, station position nested', () => {
    const reading = parseTidesResource(
      {
        station: {
          name: 'Rincon Point, Pier 22 1/2',
          position: { latitude: 37.79, longitude: -122.387 },
        },
        extremes: [
          { time: '2026-06-08T13:18:00.000Z', type: 'Low', value: 0.044 },
          { time: '2026-06-08T19:45:00.000Z', type: 'High', value: 1.815 },
        ],
      },
      37.8,
      -122.4,
      NOW_MS,
    );
    expect(reading?.station.name).toBe('Rincon Point, Pier 22 1/2');
    expect(reading?.station.latitude).toBe(37.79);
    expect(reading?.station.longitude).toBe(-122.387);
    expect(reading?.distanceMeters).toBeGreaterThan(0);
    expect(reading?.events).toEqual([
      { timeMs: Date.UTC(2026, 5, 8, 13, 18), heightMeters: 0.044, kind: 'low' },
      { timeMs: Date.UTC(2026, 5, 8, 19, 45), heightMeters: 1.815, kind: 'high' },
    ]);
  });

  it('parses the 2.x shape: label and level, flat station with id', () => {
    const reading = parseTidesResource(
      {
        datum: 'MLLW',
        units: 'meters',
        station: {
          id: 'noaa/9414290',
          name: 'San Francisco',
          latitude: 37.806,
          longitude: -122.465,
        },
        extremes: [
          { time: '2026-06-08T07:20:00.000Z', level: 1.928, high: true, low: false, label: 'High' },
          { time: '2026-06-08T00:45:00.000Z', level: 0.025, high: false, low: true, label: 'Low' },
        ],
      },
      37.8,
      -122.4,
      NOW_MS,
    );
    expect(reading?.station.id).toBe('noaa/9414290');
    // Events come back sorted even when the wire order is not.
    expect(reading?.events.map((e) => e.kind)).toEqual(['low', 'high']);
    expect(reading?.events[1].heightMeters).toBeCloseTo(1.928);
  });

  it('reads the kind from the high and low booleans when no label is present', () => {
    const reading = parseTidesResource(
      {
        extremes: [
          { time: '2026-06-08T07:20:00.000Z', level: 1.9, high: true, low: false },
          { time: '2026-06-08T13:18:00.000Z', level: 0.1, high: false, low: true },
        ],
      },
      37.8,
      -122.4,
      NOW_MS,
    );
    expect(reading?.events.map((e) => e.kind)).toEqual(['high', 'low']);
  });

  it('synthesizes a local station at the given position when station metadata is absent', () => {
    const reading = parseTidesResource(
      { extremes: [{ time: '2026-06-08T07:20:00.000Z', type: 'High', value: 1.9 }] },
      27.7,
      -82.7,
      NOW_MS,
    );
    expect(reading?.station).toEqual({
      id: 'tides',
      name: 'Local tides (signalk-tides)',
      latitude: 27.7,
      longitude: -82.7,
    });
    expect(reading?.distanceMeters).toBe(0);
  });

  it('trims events to the 48-hour window from the current UTC day', () => {
    const reading = parseTidesResource(
      {
        extremes: [
          { time: '2026-06-07T22:00:00.000Z', type: 'High', value: 1.0 },
          { time: '2026-06-08T04:00:00.000Z', type: 'Low', value: 0.1 },
          { time: '2026-06-09T23:00:00.000Z', type: 'High', value: 1.2 },
          { time: '2026-06-10T06:00:00.000Z', type: 'Low', value: 0.2 },
        ],
      },
      27.7,
      -82.7,
      NOW_MS,
    );
    expect(reading?.events.map((e) => e.timeMs)).toEqual([
      Date.UTC(2026, 5, 8, 4, 0),
      Date.UTC(2026, 5, 9, 23, 0),
    ]);
  });

  it('skips malformed entries and returns undefined when nothing usable remains', () => {
    const malformed = {
      extremes: [
        { time: 'not-a-time', type: 'High', value: 1.0 },
        { time: '2026-06-08T04:00:00.000Z', type: 'Slack', value: 0.1 },
        { time: '2026-06-08T05:00:00.000Z', type: 'High' },
        'nonsense',
      ],
    };
    expect(parseTidesResource(malformed, 27.7, -82.7, NOW_MS)).toBeUndefined();
    expect(parseTidesResource(undefined, 27.7, -82.7, NOW_MS)).toBeUndefined();
    expect(parseTidesResource([], 27.7, -82.7, NOW_MS)).toBeUndefined();
    expect(parseTidesResource({ extremes: [] }, 27.7, -82.7, NOW_MS)).toBeUndefined();
  });

  it('rejects numeric strings with trailing units or text', () => {
    expect(
      parseTidesResource(
        {
          station: { latitude: '27.7north', longitude: '-82.7west' },
          extremes: [{ time: '2026-06-08T07:20:00.000Z', type: 'High', value: '1.2m' }],
        },
        27.7,
        -82.7,
        NOW_MS,
      ),
    ).toBeUndefined();
  });
});

describe('fetchSignalkTidesReading', () => {
  const body = { extremes: [{ time: '2026-06-08T07:20:00.000Z', type: 'High', value: 1.9 }] };

  it('fetches the tides resource with the origin and bearer token', async () => {
    const fetchMock = mockFetch(body);
    const reading = await fetchSignalkTidesReading(27.7, -82.7, {
      origin: 'https://boat.local:3443',
      token: 't0k3n',
      now: () => NOW_MS,
    });
    expect(reading?.events).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://boat.local:3443/signalk/v2/api/resources/tides',
    );
    expect(
      (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization,
    ).toBe('Bearer t0k3n');
  });

  it('defaults to a same-origin request with no auth header', async () => {
    const fetchMock = mockFetch(body);
    await fetchSignalkTidesReading(27.7, -82.7, { now: () => NOW_MS });
    expect(String(fetchMock.mock.calls[0][0])).toBe('/signalk/v2/api/resources/tides');
  });

  it('returns undefined on a non-ok response', async () => {
    mockFetch({}, false, 500);
    expect(await fetchSignalkTidesReading(27.7, -82.7, { now: () => NOW_MS })).toBeUndefined();
  });

  it('returns undefined when the fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    expect(await fetchSignalkTidesReading(27.7, -82.7, { now: () => NOW_MS })).toBeUndefined();
  });
});
