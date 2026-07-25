import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCurrentEvents,
  fetchCurrentStations,
  fetchTideEvents,
  fetchTideStations,
  utcYmd,
} from './coops-client';

function mockFetch(json: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => ({ ok, status, json: async () => json }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('coops-client', () => {
  it('parses tide stations into SI positions', async () => {
    mockFetch({ stations: [{ id: '1', name: 'A', lat: 27.7, lng: -82.7 }] });
    expect(await fetchTideStations()).toEqual([
      { id: '1', name: 'A', latitude: 27.7, longitude: -82.7 },
    ]);
  });

  it('fetches current stations with the currentpredictions type and maps lat and lng', async () => {
    const fetchMock = mockFetch({
      stations: [
        { id: 'ACT8451', name: 'Tampa Bay Entrance', lat: 27.6, lng: -82.6 },
        { id: 'PUG1515', name: 'Puget Sound', lat: 47.5, lng: -122.3 },
      ],
    });
    const stations = await fetchCurrentStations();
    expect(stations).toEqual([
      { id: 'ACT8451', name: 'Tampa Bay Entrance', latitude: 27.6, longitude: -82.6 },
      { id: 'PUG1515', name: 'Puget Sound', latitude: 47.5, longitude: -122.3 },
    ]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('type=currentpredictions');
  });

  it('parses tide events with meters and a high or low kind', async () => {
    const fetchMock = mockFetch({
      predictions: [
        { t: '2026-06-08 09:34', v: '0.532', type: 'H' },
        { t: '2026-06-08 15:17', v: '0.307', type: 'L' },
      ],
    });
    const events = await fetchTideEvents('8726520');
    expect(events[0].heightMeters).toBeCloseTo(0.532);
    expect(events[0].kind).toBe('high');
    expect(events[1].kind).toBe('low');
    expect(Number.isFinite(events[0].timeMs)).toBe(true);
    const request = new URL(String(fetchMock.mock.calls[0][0]));
    expect(request.searchParams.get('time_zone')).toBe('gmt');
    expect(request.searchParams.get('station')).toBe('8726520');
  });

  it('parses prediction timestamps as UTC, not browser-local', async () => {
    mockFetch({ predictions: [{ t: '2026-06-08 09:34', v: '0.532', type: 'H' }] });
    const events = await fetchTideEvents('8726520');
    // time_zone=gmt is requested, so '2026-06-08 09:34' is 09:34 UTC in any browser timezone.
    expect(events[0].timeMs).toBe(Date.UTC(2026, 5, 8, 9, 34));
  });

  it('rejects a tide height with a unit suffix', async () => {
    mockFetch({ predictions: [{ t: '2026-06-08 09:34', v: '0.532m', type: 'H' }] });
    await expect(fetchTideEvents('8726520')).resolves.toEqual([]);
  });

  it('converts current velocity from cm/s to SI m/s and reads the set', async () => {
    mockFetch({
      current_predictions: {
        cp: [
          {
            Type: 'flood',
            Time: '2026-06-08 05:58',
            Velocity_Major: 20.4,
            meanFloodDir: 100,
            meanEbbDir: 280,
          },
          {
            Type: 'slack',
            Time: '2026-06-08 02:27',
            Velocity_Major: 0,
            meanFloodDir: 100,
            meanEbbDir: 280,
          },
          {
            Type: 'ebb',
            Time: '2026-06-08 09:01',
            Velocity_Major: -31.9,
            meanFloodDir: 100,
            meanEbbDir: 280,
          },
        ],
      },
    });
    const events = await fetchCurrentEvents('ACT8451');
    expect(events[0].timeMs).toBe(Date.UTC(2026, 5, 8, 5, 58));
    expect(events[0].velocityMps).toBeCloseTo(0.204);
    expect(events[0].directionRad).toBeCloseTo((100 * Math.PI) / 180);
    expect(events[0].kind).toBe('flood');
    expect(events[1].kind).toBe('slack');
    expect(events[1].directionRad).toBeUndefined();
    // Ebb Velocity_Major is negative on the wire; speed is stored as a magnitude.
    expect(events[2].kind).toBe('ebb');
    expect(events[2].velocityMps).toBeCloseTo(0.319);
    expect(events[2].directionRad).toBeCloseTo((280 * Math.PI) / 180);
  });

  it('throws on a non-ok response', async () => {
    mockFetch({}, false, 503);
    await expect(fetchTideStations()).rejects.toThrow();
  });

  it('rejects an unsafe station id before fetching', async () => {
    const fetchMock = mockFetch({ predictions: [] });
    await expect(fetchTideEvents('8726520&product=currents_predictions')).rejects.toThrow(
      /station id/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized or malformed station and event arrays before iterating', async () => {
    mockFetch({ stations: Array.from({ length: 20_001 }, () => null) });
    await expect(fetchTideStations()).rejects.toThrow(/station response/);

    mockFetch({ predictions: Array.from({ length: 201 }, () => null) });
    await expect(fetchTideEvents('8726520')).rejects.toThrow(/tide prediction response/);

    mockFetch({ current_predictions: { cp: {} } });
    await expect(fetchCurrentEvents('ACT8451')).rejects.toThrow(/current prediction response/);
  });

  it('builds the UTC day key from UTC date parts', () => {
    // 2026-06-09 04:30 UTC is still 2026-06-08 on a UTC-5 device; the key must follow UTC.
    const ms = Date.UTC(2026, 5, 9, 4, 30);
    expect(utcYmd(ms)).toBe('20260609');
    expect(utcYmd(ms, '-')).toBe('2026-06-09');
  });
});
