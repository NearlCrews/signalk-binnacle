import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bbox4 } from '$shared/geo';
import { expectBearerAuth, stubFetch } from '$shared/testing';
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
    expectBearerAuth(init, 'tok');
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
        'vessels.non-finite': {
          type: 'MultiLineString',
          coordinates: [
            [
              [-83, 42],
              [Number.POSITIVE_INFINITY, 42.1],
            ],
          ],
        },
        'vessels.out-of-range': {
          type: 'MultiLineString',
          coordinates: [
            [
              [-83, 42],
              [-82.9, 91],
            ],
          ],
        },
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

  it('drops a trail that exceeds the per-line point budget', async () => {
    stubFetch({
      ok: true,
      body: {
        'vessels.too-long': {
          type: 'MultiLineString',
          coordinates: [Array.from({ length: 10_001 }, () => [-83, 42])],
        },
      },
    });

    await expect(fetchAisTrails(BASE, undefined, BBOX)).resolves.toEqual([]);
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

  describe('at the antimeridian', () => {
    const UNWRAPPED: Bbox4 = [170, 0, 190, 10];

    it('splits an unwrapped area into two in-range requests', async () => {
      const mock = stubFetch({ ok: true, body: {} });
      await fetchAisTrails(BASE, undefined, UNWRAPPED);
      expect(mock).toHaveBeenCalledTimes(2);
      expect(mock.mock.calls[0][0]).toBe(`${BASE}/signalk/v1/api/tracks?bbox=0,170,10,180`);
      expect(mock.mock.calls[1][0]).toBe(`${BASE}/signalk/v1/api/tracks?bbox=0,-180,10,-170`);
    });

    it('merges both sides and keeps one line per vessel across the seam', async () => {
      const multiLine = (...lines: Array<Array<[number, number]>>) => ({
        type: 'MultiLineString',
        coordinates: lines,
      });
      const west = {
        'vessels.a': multiLine([
          [179, 1],
          [180, 1],
        ]),
      };
      const east = {
        'vessels.a': multiLine([
          [-180, 1],
          [-179, 1],
        ]),
        'vessels.b': multiLine([
          [-178, 2],
          [-177, 2],
        ]),
      };
      let call = 0;
      const mock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => (call++ === 0 ? west : east),
      }));
      vi.stubGlobal('fetch', mock);
      const trails = await fetchAisTrails(BASE, undefined, UNWRAPPED);
      expect(trails?.map((trail) => trail.context)).toEqual(['vessels.a', 'vessels.b']);
    });

    it('returns undefined when either side fails rather than half the picture', async () => {
      let call = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          const ok = call++ === 0;
          return { ok, status: ok ? 200 : 500, json: async () => ({}) };
        }),
      );
      await expect(fetchAisTrails(BASE, undefined, UNWRAPPED)).resolves.toBeUndefined();
    });
  });
});
