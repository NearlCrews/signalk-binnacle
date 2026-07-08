import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bbox4 } from '$shared/geo';
import { stubFetch } from '$shared/testing/fetch-stub';
import { fetchAisTrails } from './ais-trails-client';

const BASE = 'https://boat.example';
const BBOX: Bbox4 = [-83.5, 42.0, -82.5, 43.0];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAisTrails', () => {
  it('requests the tracks route with a lat-first bbox and the bearer token', async () => {
    const mock = stubFetch({ ok: true, body: {} });
    await fetchAisTrails(BASE, 'tok', BBOX);
    const [url, init] = mock.mock.calls[0];
    // south,west,north,east: the order the plugin's positional sw/ne parse actually honors.
    expect(url).toBe(`${BASE}/signalk/v1/api/tracks?bbox=42,-83.5,43,-82.5`);
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer tok');
  });

  it('flattens the context-keyed MultiLineStrings into one trail per line', async () => {
    stubFetch({
      ok: true,
      body: {
        'vessels.urn:mrn:imo:mmsi:111111111': {
          type: 'MultiLineString',
          coordinates: [
            [
              [-83.1, 42.2],
              [-83.0, 42.3],
            ],
          ],
        },
        'vessels.urn:mrn:imo:mmsi:222222222': {
          type: 'MultiLineString',
          coordinates: [
            [
              [-82.9, 42.4],
              [-82.8, 42.5],
            ],
            [
              [-82.7, 42.6],
              [-82.6, 42.7],
            ],
          ],
        },
      },
    });
    const trails = await fetchAisTrails(BASE, undefined, BBOX);
    expect(trails).toEqual([
      {
        context: 'vessels.urn:mrn:imo:mmsi:111111111',
        line: [
          [-83.1, 42.2],
          [-83.0, 42.3],
        ],
      },
      {
        context: 'vessels.urn:mrn:imo:mmsi:222222222',
        line: [
          [-82.9, 42.4],
          [-82.8, 42.5],
        ],
      },
      {
        context: 'vessels.urn:mrn:imo:mmsi:222222222',
        line: [
          [-82.7, 42.6],
          [-82.6, 42.7],
        ],
      },
    ]);
  });

  it('drops malformed entries and lines too short to draw, keeping the rest', async () => {
    stubFetch({
      ok: true,
      body: {
        'vessels.short': { type: 'MultiLineString', coordinates: [[[-83.0, 42.0]]] },
        'vessels.corrupt': {
          type: 'MultiLineString',
          coordinates: [
            [
              [-83.0, 42.0],
              ['bad', 42.1],
            ],
          ],
        },
        'vessels.no-coords': { type: 'MultiLineString' },
        'vessels.junk': 7,
        'vessels.good': {
          type: 'MultiLineString',
          coordinates: [
            [
              [-83.0, 42.0],
              [-82.9, 42.1],
            ],
          ],
        },
      },
    });
    const trails = await fetchAisTrails(BASE, undefined, BBOX);
    expect(trails).toEqual([
      {
        context: 'vessels.good',
        line: [
          [-83.0, 42.0],
          [-82.9, 42.1],
        ],
      },
    ]);
  });

  it('returns undefined on a 404, the degrade signal for an absent or stopped plugin', async () => {
    stubFetch({ ok: false });
    await expect(fetchAisTrails(BASE, undefined, BBOX)).resolves.toBeUndefined();
  });

  it('returns undefined on a transport failure instead of throwing', async () => {
    stubFetch('reject');
    await expect(fetchAisTrails(BASE, undefined, BBOX)).resolves.toBeUndefined();
  });

  it('returns undefined on a non-keyed body (an array or null)', async () => {
    stubFetch({ ok: true, body: [] });
    await expect(fetchAisTrails(BASE, undefined, BBOX)).resolves.toBeUndefined();
  });

  it('returns [] for a reachable plugin with no tracks', async () => {
    stubFetch({ ok: true, body: {} });
    await expect(fetchAisTrails(BASE, undefined, BBOX)).resolves.toEqual([]);
  });
});
