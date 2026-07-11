import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing/fetch-stub';
import { discoverBatteries, discoverInstrumentInstances } from './instance-discovery';

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
    });
  });

  it('sends the bearer header when a token is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { house: { voltage: {} } }));
    vi.stubGlobal('fetch', fetchMock);
    await discoverBatteries('http://pi', 'my-token');
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
    });
  });
});
