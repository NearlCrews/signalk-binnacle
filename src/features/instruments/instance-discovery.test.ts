import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing';
import {
  discoverHistoricalInstrumentInstances,
  discoverInstrumentInstances,
  historicalInstrumentInstances,
  INSTRUMENT_HISTORY_WINDOW_SECONDS,
} from './instance-discovery';

describe('discoverInstrumentInstances', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns sorted instance keys for each supported branch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/electrical/batteries')) {
          return jsonResponse(200, {
            starter: { voltage: {} },
            house: { capacity: {} },
            stub: { name: { value: 'stub' } },
          });
        }
        if (url.endsWith('/propulsion')) {
          return jsonResponse(200, { port: { revolutions: {} }, aux: { engineLoad: {} } });
        }
        if (url.endsWith('/tanks')) {
          return jsonResponse(200, {
            fresh: { currentLevel: {} },
            black: { type: {} },
            fuel: {
              starboard: { currentLevel: {} },
              stub: { name: { value: 'stub' } },
              port: { currentVolume: {} },
            },
          });
        }
        if (url.endsWith('/electrical/solar')) {
          return jsonResponse(200, { arch: { panelPower: {} } });
        }
        if (url.endsWith('/environment/inside')) {
          return jsonResponse(200, { cabin: { temperature: {} } });
        }
        return jsonResponse(404, {});
      }),
    );

    await expect(discoverInstrumentInstances('http://pi', 'tok')).resolves.toEqual({
      batteries: ['house', 'starter'],
      propulsion: ['aux', 'port'],
      tanks: ['black', 'fresh', 'fuel.port', 'fuel.starboard'],
      solar: ['arch'],
      inside: ['cabin'],
      failedFamilies: [],
      paths: [
        'electrical.batteries.starter.voltage',
        'electrical.solar.arch.panelPower',
        'environment.inside.cabin.temperature',
        'propulsion.aux.engineLoad',
        'propulsion.port.revolutions',
        'tanks.fresh.currentLevel',
        'tanks.fuel.port.currentVolume',
        'tanks.fuel.starboard.currentLevel',
      ],
    });
  });

  it('sends the bearer header when a token is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { house: { voltage: {} } }));
    vi.stubGlobal('fetch', fetchMock);
    await discoverInstrumentInstances('http://pi', 'my-token');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi/signalk/v1/api/vessels/self/electrical/batteries');
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(
      'Bearer my-token',
    );
  });

  it('returns empty lists on failures or unexpected bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/electrical/batteries')) return jsonResponse(200, ['array']);
        if (url.endsWith('/propulsion')) throw new TypeError('network down');
        return jsonResponse(401, {});
      }),
    );

    await expect(discoverInstrumentInstances('http://pi', undefined)).resolves.toEqual({
      batteries: [],
      propulsion: [],
      tanks: [],
      solar: [],
      inside: [],
      failedFamilies: ['batteries', 'propulsion', 'tanks', 'solar', 'inside'],
      paths: [],
    });
  });

  it('rejects Signal K error envelopes and overlong instance ids', async () => {
    const overlongId = 'x'.repeat(129);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/electrical/batteries')) {
          return jsonResponse(200, { [overlongId]: { voltage: {} } });
        }
        if (url.endsWith('/propulsion')) {
          return jsonResponse(200, { state: 'FAILED', statusCode: 500, message: 'bad query' });
        }
        return jsonResponse(404, {});
      }),
    );

    const result = await discoverInstrumentInstances('http://pi', undefined);
    expect(result.batteries).toEqual([]);
    expect(result.propulsion).toEqual([]);
    expect(result.failedFamilies).toEqual(['propulsion']);
  });

  it('extracts supported instances and concrete readings from historical paths', () => {
    expect(
      historicalInstrumentInstances([
        'electrical.batteries.house.voltage',
        'electrical.batteries.house.capacity.stateOfCharge',
        'propulsion.port.revolutions',
        'propulsion.port.fuel.rate',
        'propulsion.port.transmission.gear',
        'electrical.batteries.house.voltage.extra',
        'electrical.solar.arch.loadCurrent',
        'tanks.fuel.port.type',
        'tanks.fuel.port.currentLevel',
        'tanks.fresh.currentVolume',
        'electrical.solar.arch.panelPower',
        'environment.inside.mainCabin.relativeHumidity',
        'navigation.speedOverGround',
        'propulsion.bad.id.revolutions',
      ]),
    ).toEqual({
      batteries: ['house'],
      propulsion: ['port'],
      tanks: ['fresh', 'fuel.port'],
      solar: ['arch'],
      inside: ['mainCabin'],
      paths: [
        'electrical.batteries.house.capacity.stateOfCharge',
        'electrical.batteries.house.voltage',
        'electrical.solar.arch.panelPower',
        'environment.inside.mainCabin.relativeHumidity',
        'propulsion.port.revolutions',
        'tanks.fresh.currentVolume',
        'tanks.fuel.port.currentLevel',
      ],
    });
  });

  it('discovers historical instruments through the bounded provider set', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/paths?') && url.includes('provider=kip')) {
        return jsonResponse(200, []);
      }
      if (url.includes('/paths?') && url.includes('provider=signalk-questdb')) {
        return jsonResponse(200, [
          'propulsion.starboard.revolutions',
          'propulsion.starboard.engineLoad',
        ]);
      }
      if (url.includes('/values?') && url.includes('provider=kip')) {
        return jsonResponse(200, {
          range: { from: '2026-07-01T00:00:00Z', to: '2026-07-01T01:00:00Z' },
          values: [],
          data: [],
        });
      }
      if (url.includes('/values?') && url.includes('provider=signalk-questdb')) {
        return jsonResponse(200, {
          range: { from: '2026-07-01T00:00:00Z', to: '2026-07-01T01:00:00Z' },
          values: [
            { path: 'propulsion.starboard.engineLoad' },
            { path: 'propulsion.starboard.revolutions' },
          ],
          data: [['2026-07-01T00:00:00Z', 0.5, 20]],
        });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      discoverHistoricalInstrumentInstances('http://pi', 'tok', {
        ids: ['kip', 'signalk-questdb'],
      }),
    ).resolves.toEqual({
      state: 'complete',
      instances: {
        batteries: [],
        propulsion: ['starboard'],
        tanks: [],
        solar: [],
        inside: [],
        paths: ['propulsion.starboard.engineLoad', 'propulsion.starboard.revolutions'],
      },
    });
    const pathUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/paths?'));
    expect(pathUrls).toHaveLength(2);
    expect(
      pathUrls.every((url) => url.includes(`duration=${INSTRUMENT_HISTORY_WINDOW_SECONDS}`)),
    ).toBe(true);
  });

  it('reports failed when every validation request for a nonempty catalog fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/paths?')
          ? jsonResponse(200, ['propulsion.port.revolutions'])
          : jsonResponse(501, {}),
      ),
    );

    await expect(
      discoverHistoricalInstrumentInstances('http://pi', undefined, {
        ids: ['signalk-questdb'],
      }),
    ).resolves.toMatchObject({ state: 'failed' });
  });
});
