import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackPoint } from '$entities/track';
import { jsonResponse } from '$shared/testing';
import {
  deleteTrack,
  fetchSavedTracks,
  fetchTracksProvisioned,
  type SavedTrack,
  savedTrackFromPoints,
  savedTracksToFeatures,
  saveTrack,
} from './tracks-client';

const p = (lat: number, lon: number, gap?: boolean): TrackPoint => ({
  lat,
  lon,
  t: 0,
  sog: 1,
  gap,
});

describe('fetchSavedTracks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses a keyed object of MultiLineString features into segments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        t1: {
          type: 'Feature',
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [-83.5, 42.6],
                [-83.4, 42.7],
              ],
              [
                [-83.3, 42.8],
                [-83.2, 42.9],
              ],
            ],
          },
          properties: { name: 'Day 1', distance: 1234.5, timespan: 3600 },
        },
        err: { state: 'FAILED', statusCode: 404 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const tracks = await fetchSavedTracks('http://pi', 'tok');
    if (!tracks) throw new Error('expected tracks');
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ id: 't1', name: 'Day 1' });
    expect(tracks[0].points).toHaveLength(2);
    expect(tracks[0].points[0][0]).toMatchObject({ lat: 42.6, lon: -83.5 });
    // The SI distance and timespan saved with the geometry are carried onto the SavedTrack.
    expect(tracks[0].distanceMeters).toBe(1234.5);
    expect(tracks[0].durationSeconds).toBe(3600);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/signalk/v2/api/resources/tracks');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('falls back to v1 when v2 is not ok and parses a LineString as one segment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          t1: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: { name: 'Leg' },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const tracks = await fetchSavedTracks('http://pi');
    if (!tracks) throw new Error('expected tracks');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].points).toHaveLength(1);
    // A track saved without distance/timespan metadata carries them as undefined, not zero.
    expect(tracks[0].distanceMeters).toBeUndefined();
    expect(tracks[0].durationSeconds).toBeUndefined();
    expect(fetchMock.mock.calls[1][0]).toContain('/signalk/v1/api/resources/tracks');
  });

  it('returns undefined on an error response so the caller keeps the current list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));
    expect(await fetchSavedTracks('http://pi')).toBeUndefined();
  });

  it('returns an empty list, not undefined, when both endpoints 404 (no track ever saved)', async () => {
    // A fresh server has never had a track PUT to it, so the resources/tracks collection was
    // never created and both endpoints 404; that is "reachable, nothing there" and must not read
    // as a connection failure the way an unreachable server or a real error status does.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, {})));
    expect(await fetchSavedTracks('http://pi')).toEqual([]);
  });

  it('trims names and rejects negative metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          t1: {
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: { name: '  Passage  ', distance: -1, timespan: -2 },
          },
        }),
      ),
    );
    const tracks = await fetchSavedTracks('http://pi');
    expect(tracks?.[0]).toMatchObject({ name: 'Passage' });
    expect(tracks?.[0].distanceMeters).toBeUndefined();
    expect(tracks?.[0].durationSeconds).toBeUndefined();
  });

  it('stops decoding entries after the saved-track limit', async () => {
    const keyed: Record<string, unknown> = {};
    for (let index = 0; index < 500; index += 1) {
      keyed[`track-${index}`] = {
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      };
    }
    let overflowDecoded = false;
    keyed.overflow = {
      get geometry() {
        overflowDecoded = true;
        throw new Error('overflow track should not be decoded');
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => keyed } as Response),
    );

    const tracks = await fetchSavedTracks('http://pi');
    expect(tracks).toHaveLength(500);
    expect(overflowDecoded).toBe(false);
  });
});

describe('fetchTracksProvisioned', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The resources API answers _providers with a plain array of provider id strings, unlike the
  // history and weather APIs, whose route answers with a keyed object.
  it('reports a registered provider as provisioned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, ['resources-provider']));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchTracksProvisioned('http://pi', 'tok')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi/signalk/v2/api/resources/tracks/_providers');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('reports an answered empty provider list as unprovisioned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));
    expect(await fetchTracksProvisioned('http://pi')).toBe(false);
  });

  it('stays unknown when the probe itself does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));
    expect(await fetchTracksProvisioned('http://pi')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await fetchTracksProvisioned('http://pi')).toBeUndefined();
  });
});

describe('savedTrackFromPoints', () => {
  it('builds optimistic saved geometry and SI metadata', () => {
    const track = savedTrackFromPoints('id', '  Day 1  ', [p(0, 0), p(0, 0.001)]);
    expect(track.name).toBe('Day 1');
    expect(track.points).toHaveLength(1);
    expect(track.distanceMeters).toBeGreaterThan(100);
    expect(track.durationSeconds).toBe(0);
  });
});

describe('saveTrack', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('PUTs a MultiLineString feature split at gaps and returns true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    const points = [p(42.6, -83.5), p(42.7, -83.4), p(42.8, -83.3, true), p(42.9, -83.2)];
    const ok = await saveTrack('http://pi', 'tok', 'abc', 'Day 1', points);
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi/signalk/v2/api/resources/tracks/abc');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.geometry.type).toBe('MultiLineString');
    expect(body.geometry.coordinates).toEqual([
      [
        [-83.5, 42.6],
        [-83.4, 42.7],
      ],
      [
        [-83.3, 42.8],
        [-83.2, 42.9],
      ],
    ]);
    expect(body.properties).toMatchObject({ name: 'Day 1', source: 'binnacle' });
  });

  it('returns false on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, {})));
    expect(await saveTrack('http://pi', 't', 'id', 'n', [p(0, 0), p(1, 1)])).toBe(false);
  });

  it('returns false when the fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await saveTrack('http://pi', 't', 'id', 'n', [p(0, 0), p(1, 1)])).toBe(false);
  });
});

describe('savedTracksToFeatures', () => {
  const track: SavedTrack = {
    id: 'a',
    name: 'A',
    points: [[p(0, 0), p(1, 1)], [p(2, 2)]],
  };

  it('emits a LineString per shown segment and drops single-point segments', () => {
    const fc = savedTracksToFeatures([track], new Set(['a']));
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    });
    expect(fc.features[0].properties).toEqual({ id: 'a' });
  });

  it('omits tracks that are not shown', () => {
    expect(savedTracksToFeatures([track], new Set()).features).toHaveLength(0);
  });

  it('splits a saved track crossing the antimeridian', () => {
    const crossing: SavedTrack = {
      id: 'crossing',
      name: 'Crossing',
      points: [[p(10, 179), p(12, -179)]],
    };
    expect(savedTracksToFeatures([crossing], new Set(['crossing'])).features[0].geometry).toEqual({
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
    });
  });
});

describe('deleteTrack', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('DELETEs the track and returns true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    expect(await deleteTrack('http://pi', 'tok', 'abc')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi/signalk/v2/api/resources/tracks/abc');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('returns false on an error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, {})));
    expect(await deleteTrack('http://pi', 't', 'id')).toBe(false);
  });
});
