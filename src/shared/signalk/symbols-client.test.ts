import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing/fetch-stub';
import { fetchSymbols } from './symbols-client';

const UUID = 'b3f1c2a0-1e4d-4a6b-9c2f-0a1b2c3d4e5f';

describe('fetchSymbols', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses SVG symbols with aliases, roles, scale, and anchor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        [UUID]: {
          uuid: UUID,
          alias: ['custom:dive-flag', 'fsk:dive-site'],
          name: 'Dive Site',
          mediaType: 'image/svg+xml',
          url: `/signalk/symbol-manager/symbols/${UUID}.svg`,
          roles: ['note', 'waypoint'],
          tags: ['diving'],
          scale: 0.65,
          anchor: [1, 37],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const symbols = (await fetchSymbols('http://pi', 'tok')) ?? [];
    expect(symbols).toEqual([
      {
        uuid: UUID,
        aliases: ['custom:dive-flag', 'fsk:dive-site'],
        name: 'Dive Site',
        url: `/signalk/symbol-manager/symbols/${UUID}.svg`,
        roles: ['note', 'waypoint'],
        scale: 0.65,
        anchor: [1, 37],
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi/signalk/v2/api/resources/symbols');
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('defaults optional fields and falls back to the entry key for uuid and name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          'sym-1': { alias: ['custom:flag'], mediaType: 'image/svg+xml', url: '/s/flag.svg' },
        }),
      ),
    );
    const symbols = (await fetchSymbols('http://pi')) ?? [];
    expect(symbols).toEqual([
      {
        uuid: 'sym-1',
        aliases: ['custom:flag'],
        name: 'sym-1',
        url: '/s/flag.svg',
        roles: [],
        scale: undefined,
        anchor: undefined,
      },
    ]);
  });

  it('skips non-SVG entries, missing urls, reserved or malformed aliases, and bad anchors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          png: { alias: ['custom:a'], mediaType: 'image/png', url: '/s/a.png' },
          nourl: { alias: ['custom:b'], mediaType: 'image/svg+xml' },
          reserved: { alias: ['default:c'], mediaType: 'image/svg+xml', url: '/s/c.svg' },
          malformed: { alias: ['no-colon', 'a:b:c'], mediaType: 'image/svg+xml', url: '/s/d.svg' },
          ok: {
            alias: ['default:e', 'custom:e'],
            mediaType: 'image/svg+xml',
            url: '/s/e.svg',
            anchor: [1, 'two'],
            scale: -1,
          },
        }),
      ),
    );
    const symbols = (await fetchSymbols('http://pi')) ?? [];
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      uuid: 'ok',
      aliases: ['custom:e'],
      anchor: undefined,
      scale: undefined,
    });
  });

  it('returns an empty list on a 404 so callers keep their built-in icons', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, { state: 'FAILED' })));
    expect(await fetchSymbols('http://pi')).toEqual([]);
  });

  it('returns undefined when the fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await fetchSymbols('http://pi')).toBeUndefined();
  });

  it('returns an empty list from a reachable provider with no symbols', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {})));
    expect(await fetchSymbols('http://pi')).toEqual([]);
  });
});
