import { CHART_SOURCES } from 'signalk-chart-sources';
import { describe, expect, it } from 'vitest';
import { BOUNDARY_SOURCES } from '$features/boundaries-overlay';
import { STREAMING_CHART_SOURCES } from '$features/depth-charts';
import { MPA_SOURCES } from '$features/mpa-overlays';
import { SEAMARK_SOURCES } from '$features/seamark-overlay';
import { detectCompanion, probeCompanion, proxiedSources } from './companion';
import type { RasterOverlaySource } from './raster-overlay';

const SAMPLE: RasterOverlaySource[] = [
  {
    id: 'depth-gebco',
    title: 'GEBCO',
    tiles: ['https://wms.gebco.net/mapserv?LAYERS=GEBCO_LATEST'],
    minzoom: 0,
    maxzoom: 12,
    attribution: 'GEBCO',
  },
];

describe('detectCompanion', () => {
  it('returns the plugin base when the readiness probe is ok', async () => {
    const base = await detectCompanion(
      'http://boat.local',
      undefined,
      async () => ({ ok: true }) as Response,
    );
    expect(base).toBe('http://boat.local/plugins/signalk-chart-locker');
  });

  it('returns the plugin base when a 503 proves the plugin is installed but not ready', async () => {
    const base = await detectCompanion(
      'http://boat.local',
      undefined,
      async () => ({ ok: false, status: 503 }) as Response,
    );
    expect(base).toBe('http://boat.local/plugins/signalk-chart-locker');
  });

  it('returns null when the route is absent', async () => {
    expect(
      await detectCompanion(
        'http://boat.local',
        undefined,
        async () => ({ ok: false, status: 404 }) as Response,
      ),
    ).toBeNull();
  });

  it('returns null on a network error (no companion installed)', async () => {
    expect(
      await detectCompanion('http://boat.local', undefined, async () => {
        throw new Error('refused');
      }),
    ).toBeNull();
  });

  it('uses only the administrator session even when a device token is available', async () => {
    const sent: RequestInit[] = [];
    await detectCompanion('http://boat.local', 'tok123', async (_url, init) => {
      sent.push(init ?? {});
      return { ok: false, status: 401 } as Response;
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
    expect(sent[0]?.headers).toBeUndefined();
  });

  it('sends no Authorization header when no token is available', async () => {
    let sentHeaders: HeadersInit | undefined;
    await detectCompanion('http://boat.local', undefined, async (_url, init) => {
      sentHeaders = init?.headers;
      return { ok: true, status: 200 } as Response;
    });
    expect(sentHeaders).toBeUndefined();
  });
});

describe('probeCompanion', () => {
  it.each([
    [404, { state: 'absent' }],
    [
      403,
      {
        state: 'access-refused',
        base: 'http://boat.local/plugins/signalk-chart-locker',
      },
    ],
    [500, { state: 'unreachable' }],
  ] as const)('keeps HTTP %i distinct as $state', async (status, expected) => {
    const result = await probeCompanion(
      'http://boat.local',
      undefined,
      async () => ({ ok: false, status }) as Response,
    );
    expect(result).toEqual(expected);
  });

  it('reports an installed but starting companion as present and not ready', async () => {
    const result = await probeCompanion(
      'http://boat.local',
      undefined,
      async () => ({ ok: false, status: 503 }) as Response,
    );
    expect(result).toEqual({
      state: 'present',
      base: 'http://boat.local/plugins/signalk-chart-locker',
      ready: false,
    });
  });
});

describe('proxiedSources', () => {
  it('leaves the direct upstream URLs when no companion is present', () => {
    expect(proxiedSources(SAMPLE, null)).toBe(SAMPLE);
  });

  it('rewrites each source to the companion proxy template keyed by id', () => {
    const base = 'http://boat.local/plugins/signalk-chart-locker';
    const out = proxiedSources(SAMPLE, base);
    expect(out[0].tiles).toEqual([`${base}/tile/depth-gebco/{z}/{x}/{y}`]);
    expect(out[0].id).toBe('depth-gebco'); // other fields preserved
  });
});

describe('proxiedSources with a non-raster-overlay shape', () => {
  it('rewrites tiles for any source shaped with id and tiles', () => {
    const sources = [
      {
        id: 'seascape-dem',
        tiles: ['https://tiles.openwaters.io/seascape/{z}/{x}/{y}.webp'],
        maxzoom: 17,
      },
    ];
    const out = proxiedSources(sources, 'http://pi.local/plugins/signalk-chart-locker');
    expect(out[0].tiles).toEqual([
      'http://pi.local/plugins/signalk-chart-locker/tile/seascape-dem/{z}/{x}/{y}',
    ]);
    expect(out[0].maxzoom).toBe(17);
  });
});

describe('proxied overlay ids match the companion registry', () => {
  it('every proxied overlay id exists in CHART_SOURCES, so the proxy resolves it', () => {
    const registryIds = new Set(CHART_SOURCES.map((s) => s.id));
    for (const s of [
      ...STREAMING_CHART_SOURCES,
      ...BOUNDARY_SOURCES,
      ...MPA_SOURCES,
      ...SEAMARK_SOURCES,
    ]) {
      expect(
        registryIds.has(s.id),
        `${s.id} is not in CHART_SOURCES; the companion proxy would 404 it`,
      ).toBe(true);
    }
  });
});
