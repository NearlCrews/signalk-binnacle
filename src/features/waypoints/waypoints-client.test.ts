import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Waypoint } from '$entities/waypoint';
import { jsonResponse } from '$shared/testing/fetch-stub';
import { deleteWaypoint, fetchWaypoints, MAX_WAYPOINTS, saveWaypoint } from './waypoints-client';

afterEach(() => vi.restoreAllMocks());

const WAYPOINT_BODY = {
  name: 'W',
  feature: {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [1, 2] },
    properties: {},
  },
};

describe('fetchWaypoints', () => {
  it('reads v2 and parses the keyed object into waypoints', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, { 'id-1': WAYPOINT_BODY }));
    const waypoints = await fetchWaypoints('http://pi', 'tok');
    expect(fetchMock.mock.calls[0][0]).toContain('/signalk/v2/api/resources/waypoints');
    expect(waypoints?.[0]?.id).toBe('id-1');
    expect(waypoints?.[0]?.position).toEqual({ latitude: 2, longitude: 1 });
  });

  it('returns undefined when both v2 and v1 are unreachable, so the list is not blanked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(500, {}));
    expect(await fetchWaypoints('http://pi')).toBeUndefined();
  });

  it('falls back to v1 when v2 is not ok', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { 'id-1': WAYPOINT_BODY }));
    const waypoints = await fetchWaypoints('http://pi');
    expect(fetchMock.mock.calls[1][0]).toContain('/signalk/v1/api/resources/waypoints');
    expect(waypoints).toHaveLength(1);
  });

  it('skips malformed entries instead of failing the list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { good: WAYPOINT_BODY, bad: { name: 'no feature' } }),
    );
    const waypoints = await fetchWaypoints('http://pi');
    expect(waypoints?.map((w) => w.id)).toEqual(['good']);
  });

  it('bounds the accepted waypoint list', async () => {
    const resources = Object.fromEntries(
      Array.from({ length: MAX_WAYPOINTS + 2 }, (_, index) => [`id-${index}`, WAYPOINT_BODY]),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, resources));
    expect(await fetchWaypoints('http://pi')).toHaveLength(MAX_WAYPOINTS);
  });
});

describe('saveWaypoint', () => {
  it('PUTs a GeoJSON waypoint body to the waypoint id and returns ok', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));
    const waypoint: Waypoint = {
      id: 'abc',
      name: 'W',
      position: { latitude: 2, longitude: 1 },
      description: 'D',
    };
    const ok = await saveWaypoint('http://pi', 'tok', waypoint);
    expect(ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://pi/signalk/v2/api/resources/waypoints/abc');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    const sent = JSON.parse(init.body as string);
    expect(sent.name).toBe('W');
    expect(sent.description).toBe('D');
    expect(sent.feature.geometry.coordinates).toEqual([1, 2]);
  });

  it('rejects an unsafe id or invalid position before fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(
      await saveWaypoint('http://pi', 'tok', {
        id: 'bad\u0000id',
        name: 'W',
        position: { latitude: 2, longitude: 1 },
      }),
    ).toBe(false);
    expect(
      await saveWaypoint('http://pi', 'tok', {
        id: 'abc',
        name: 'W',
        position: { latitude: 200, longitude: 1 },
      }),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('deleteWaypoint', () => {
  it('DELETEs the waypoint id and returns ok', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));
    const ok = await deleteWaypoint('http://pi', 'tok', 'abc');
    expect(ok).toBe(true);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('rejects an unsafe id before fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(await deleteWaypoint('http://pi', 'tok', '')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
