import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '$entities/route';
import { jsonResponse } from '$shared/testing/fetch-stub';
import { deleteRoute, fetchRoutes, MAX_ROUTES, saveRoute } from './routes-client';

afterEach(() => vi.restoreAllMocks());

const ROUTE_BODY = {
  name: 'R',
  feature: {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 0],
      ],
    },
    properties: {},
  },
};

describe('fetchRoutes', () => {
  it('reads v2 and parses the keyed object into routes', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, { 'id-1': ROUTE_BODY }));
    const routes = await fetchRoutes('http://pi', 'tok');
    expect(fetchMock.mock.calls[0][0]).toContain('/signalk/v2/api/resources/routes');
    expect(routes?.[0]?.id).toBe('id-1');
    expect(routes?.[0]?.waypoints).toHaveLength(2);
  });

  it('returns undefined when both v2 and v1 are unreachable, so the list is not blanked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(500, {}));
    expect(await fetchRoutes('http://pi')).toBeUndefined();
  });

  it('falls back to v1 when v2 is not ok', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { 'id-1': ROUTE_BODY }));
    const routes = await fetchRoutes('http://pi');
    expect(fetchMock.mock.calls[1][0]).toContain('/signalk/v1/api/resources/routes');
    expect(routes).toHaveLength(1);
  });

  it('bounds the accepted route collection', async () => {
    const resources = Object.fromEntries(
      Array.from({ length: MAX_ROUTES + 2 }, (_, index) => [`id-${index}`, ROUTE_BODY]),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, resources));
    expect(await fetchRoutes('http://pi')).toHaveLength(MAX_ROUTES);
  });
});

describe('saveRoute', () => {
  it('PUTs a GeoJSON route body to the route id and returns ok', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));
    const route: Route = {
      id: 'abc',
      name: 'R',
      waypoints: [
        { position: { latitude: 0, longitude: 0 } },
        { position: { latitude: 0, longitude: 1 } },
      ],
    };
    const ok = await saveRoute('http://pi', 'tok', route);
    expect(ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://pi/signalk/v2/api/resources/routes/abc');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    const sent = JSON.parse(init.body as string);
    expect(sent.feature.geometry.coordinates[1]).toEqual([1, 0]);
  });

  it('rejects unsafe ids and invalid geometry before fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(
      await saveRoute('http://pi', 'tok', {
        id: 'bad\u0000id',
        name: 'R',
        waypoints: ROUTE_BODY.feature.geometry.coordinates.map(([longitude, latitude]) => ({
          position: { latitude, longitude },
        })),
      }),
    ).toBe(false);
    expect(
      await saveRoute('http://pi', 'tok', {
        id: 'abc',
        name: 'R',
        waypoints: [
          { position: { latitude: 0, longitude: 0 } },
          { position: { latitude: 100, longitude: 1 } },
        ],
      }),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('deleteRoute', () => {
  it('DELETEs the route id and returns ok', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));
    const ok = await deleteRoute('http://pi', 'tok', 'abc');
    expect(ok).toBe(true);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('rejects an unsafe id before fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(await deleteRoute('http://pi', 'tok', '')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
