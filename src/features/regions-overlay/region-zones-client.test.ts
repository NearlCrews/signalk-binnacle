import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import {
  fetchRegionZones,
  isAnchoringProhibition,
  MAX_REGION_ZONES,
  REGION_ZONES_PATH,
  REGION_ZONES_V1_PATH,
} from './region-zones-client';

// A synthetic closed square ring at the given corner, obviously not upstream truth.
function ring(lon: number, lat: number): number[][] {
  return [
    [lon, lat],
    [lon + 1, lat],
    [lon + 1, lat + 1],
    [lon, lat + 1],
    [lon, lat],
  ];
}

function polygonRegion(name: string, description?: string): unknown {
  return {
    name,
    description,
    feature: {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring(10, 50)] },
      properties: {},
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchRegionZones', () => {
  it('decodes a v2 collection with bearer auth and grades anchoring prohibitions', async () => {
    const mock = stubFetch({
      ok: true,
      body: {
        'urn:mrn:signalk:uuid:1': polygonRegion('No anchoring area', 'Cable crossing'),
        'urn:mrn:signalk:uuid:2': polygonRegion('Race area'),
      },
    });
    const result = await fetchRegionZones('http://sk', 'tok');
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(mock.mock.calls[0][0]).toBe(`http://sk${REGION_ZONES_PATH}`);
    expectBearerAuth(mock.mock.calls[0][1], 'tok');
    expect(result.regions).toHaveLength(2);
    const [noAnchor, race] = result.regions;
    expect(noAnchor.severity).toBe('warning');
    expect(noAnchor.description).toBe('Cable crossing');
    expect(race.severity).toBe('neutral');
    expect(race.labelPosition).toEqual([10.5, 50.5]);
  });

  it('falls back to v1 when v2 is not found', async () => {
    const mock = stubFetch((url) =>
      url.includes('/v2/')
        ? { ok: false, status: 404 }
        : { ok: true, body: { r1: polygonRegion('Harbor limit') } },
    );
    const result = await fetchRegionZones('http://sk', undefined);
    expect(result).toMatchObject({ state: 'ok' });
    expect(mock.mock.calls[1][0]).toBe(`http://sk${REGION_ZONES_V1_PATH}`);
  });

  it('reports unavailable only when every path answers 404', async () => {
    stubFetch({ ok: false, status: 404 });
    expect((await fetchRegionZones('http://sk', undefined)).state).toBe('unavailable');
  });

  it('reports error on a network failure', async () => {
    stubFetch('reject');
    expect((await fetchRegionZones('http://sk', undefined)).state).toBe('error');
  });

  it('reports error when one path fails even though the other answers 404', async () => {
    stubFetch((url) =>
      url.includes('/v2/') ? { ok: false, status: 500 } : { ok: false, status: 404 },
    );
    expect((await fetchRegionZones('http://sk', undefined)).state).toBe('error');
  });

  it('falls through to v1 when v2 answers with an error envelope', async () => {
    stubFetch((url) =>
      url.includes('/v2/')
        ? { ok: true, body: { state: 'FAILED', statusCode: 500, message: 'boom' } }
        : { ok: true, body: { r1: polygonRegion('Harbor limit') } },
    );
    const result = await fetchRegionZones('http://sk', undefined);
    expect(result.state).toBe('ok');
    if (result.state === 'ok') expect(result.regions).toHaveLength(1);
  });

  it('skips malformed entries and rejects oversized or invalid geometry', async () => {
    const openRing = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    const hugeRing = Array.from({ length: 10_001 }, (_, i) => [i / 100_000, 0]);
    const badRing = [
      [0, 0],
      [200, 0],
      [1, 1],
      [0, 0],
    ];
    stubFetch({
      ok: true,
      body: {
        good: polygonRegion('Good'),
        short: { feature: { geometry: { type: 'Polygon', coordinates: [openRing] } } },
        huge: { feature: { geometry: { type: 'Polygon', coordinates: [hugeRing] } } },
        badPosition: { feature: { geometry: { type: 'Polygon', coordinates: [badRing] } } },
        noFeature: { name: 'nothing here' },
      },
    });
    const result = await fetchRegionZones('http://sk', undefined);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.regions.map((zone) => zone.id)).toEqual(['good']);
  });

  it('caps the collection', async () => {
    const body: Record<string, unknown> = {};
    for (let i = 0; i < MAX_REGION_ZONES + 5; i += 1) body[`r${i}`] = polygonRegion(`Zone ${i}`);
    stubFetch({ ok: true, body });
    const result = await fetchRegionZones('http://sk', undefined);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.regions).toHaveLength(MAX_REGION_ZONES);
  });

  it('clips a long name and drops a control-character description', async () => {
    stubFetch({
      ok: true,
      body: {
        dirty: {
          name: 'n'.repeat(400),
          description: 'bad\u0007text',
          feature: { geometry: { type: 'Polygon', coordinates: [ring(0, 0)] } },
        },
      },
    });
    const result = await fetchRegionZones('http://sk', undefined);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.regions[0].name).toHaveLength(256);
    expect(result.regions[0].description).toBeUndefined();
    expect(result.regions[0].severity).toBe('neutral');
  });

  it('labels a MultiPolygon at its largest part and drops altitude elements', async () => {
    const smallRingWithAltitude = [
      [0, 0, 12],
      [0.1, 0, 12],
      [0.1, 0.1, 12],
      [0, 0.1, 12],
      [0, 0, 12],
    ];
    stubFetch({
      ok: true,
      body: {
        multi: {
          name: 'Two parts',
          feature: {
            geometry: {
              type: 'MultiPolygon',
              coordinates: [[smallRingWithAltitude], [ring(20, 20)]],
            },
          },
        },
      },
    });
    const result = await fetchRegionZones('http://sk', undefined);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    const [zone] = result.regions;
    expect(zone.labelPosition).toEqual([20.5, 20.5]);
    expect(zone.geometry.type).toBe('MultiPolygon');
    expect(zone.geometry.coordinates[0][0][0]).toEqual([0, 0]);
  });
});

describe('isAnchoringProhibition', () => {
  it('matches the anchoring-prohibition wordings and nothing else', () => {
    expect(isAnchoringProhibition('No anchoring')).toBe(true);
    expect(isAnchoringProhibition('NO-ANCHOR ZONE')).toBe(true);
    expect(isAnchoringProhibition('Anchoring prohibited past the cable')).toBe(true);
    expect(isAnchoringProhibition('Prohibited anchorage')).toBe(true);
    expect(isAnchoringProhibition('Designated anchorage')).toBe(false);
    expect(isAnchoringProhibition('Swimming prohibited')).toBe(false);
    expect(isAnchoringProhibition('Race area')).toBe(false);
  });
});
