import { afterEach, describe, expect, it, vi } from 'vitest';
import { zoneStateFor } from '$shared/signalk';
import { jsonResponse } from '$shared/testing';
import { publishShallowZones, shallowAlarmZones } from './zone-publish';

describe('shallowAlarmZones', () => {
  it('round-trips through zoneStateFor as a below-limit alarm', () => {
    const zones = shallowAlarmZones(3);
    expect(zoneStateFor(2.9, zones)).toBe('alarm');
    expect(zoneStateFor(0, zones)).toBe('alarm');
    // Right-open banding: exactly the limit is not under it.
    expect(zoneStateFor(3, zones)).toBe('normal');
    expect(zoneStateFor(10, zones)).toBe('normal');
  });

  it('carries the bound where the monitor reads the server limit back', () => {
    expect(shallowAlarmZones(4.5)).toEqual([
      { upper: 4.5, state: 'alarm', message: 'Shallow water' },
    ]);
  });
});

describe('publishShallowZones', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('PUTs the zone to the winning path and reports published on the 202 the server answers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(202, { state: 'PENDING', statusCode: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await publishShallowZones('http://pi', 'tok', 'environment.depth.belowKeel', 3);
    expect(outcome).toBe('published');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://pi/signalk/v1/api/vessels/self/environment/depth/belowKeel/meta/zones',
    );
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      value: [{ upper: 3, state: 'alarm', message: 'Shallow water' }],
    });
  });

  it('reports unsupported for a server without the route and refused for a denied write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(405, {})));
    expect(await publishShallowZones('http://pi', 'tok', 'a.b', 3)).toBe('unsupported');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, {})));
    expect(await publishShallowZones('http://pi', 'tok', 'a.b', 3)).toBe('refused');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await publishShallowZones('http://pi', 'tok', 'a.b', 3)).toBe('failed');
  });
});
