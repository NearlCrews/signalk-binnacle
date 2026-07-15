import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing';
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

  it('rejects symbol URLs that could receive the device token off origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          absolute: {
            alias: ['custom:absolute'],
            mediaType: 'image/svg+xml',
            url: 'https://attacker.example/symbol.svg',
          },
          protocolRelative: {
            alias: ['custom:protocol-relative'],
            mediaType: 'image/svg+xml',
            url: '//attacker.example/symbol.svg',
          },
          javascript: {
            alias: ['custom:javascript'],
            mediaType: 'image/svg+xml',
            url: 'javascript:alert(1)',
          },
          safe: {
            alias: ['custom:safe'],
            mediaType: 'image/svg+xml',
            url: '/signalk/symbol-manager/safe.svg?rev=2',
          },
        }),
      ),
    );
    expect(await fetchSymbols('http://pi', 'secret-token')).toEqual([
      expect.objectContaining({ uuid: 'safe', url: '/signalk/symbol-manager/safe.svg?rev=2' }),
    ]);
  });

  it('rejects unsafe identifiers and bounded provider-controlled collections', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          'bad id': {
            alias: ['custom:bad'],
            mediaType: 'image/svg+xml',
            url: '/s/bad.svg',
          },
          aliases: {
            alias: Array.from({ length: 33 }, (_, index) => `custom:a${index}`),
            mediaType: 'image/svg+xml',
            url: '/s/aliases.svg',
          },
          roles: {
            alias: ['custom:roles'],
            mediaType: 'image/svg+xml',
            url: '/s/roles.svg',
            roles: Array.from({ length: 33 }, (_, index) => `role-${index}`),
          },
          control: {
            alias: ['custom:control\n'],
            mediaType: 'image/svg+xml',
            url: '/s/control.svg',
          },
        }),
      ),
    );
    expect(await fetchSymbols('http://pi')).toEqual([]);
  });

  it('bounds scale and anchor metadata without rejecting an otherwise usable symbol', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          safe: {
            alias: ['custom:safe'],
            mediaType: 'image/svg+xml',
            url: '/s/safe.svg',
            scale: 100,
            anchor: [-1, 5_000],
          },
        }),
      ),
    );
    expect(await fetchSymbols('http://pi')).toEqual([
      expect.objectContaining({ uuid: 'safe', scale: undefined, anchor: undefined }),
    ]);
  });

  it('caps the accepted provider collection', async () => {
    const body: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 2_005 }, (_, index) => [
        `symbol-${index}`,
        {
          alias: [`custom:symbol-${index}`],
          mediaType: 'image/svg+xml',
          url: `/s/symbol-${index}.svg`,
        },
      ]),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    expect(await fetchSymbols('http://pi')).toHaveLength(2_000);
  });

  it('keeps the first entry when the provider repeats a uuid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          first: {
            uuid: UUID,
            alias: ['custom:first'],
            mediaType: 'image/svg+xml',
            url: '/s/first.svg',
          },
          second: {
            uuid: UUID,
            alias: ['custom:second'],
            mediaType: 'image/svg+xml',
            url: '/s/second.svg',
          },
        }),
      ),
    );

    expect(await fetchSymbols('http://pi')).toEqual([
      expect.objectContaining({ uuid: UUID, aliases: ['custom:first'], url: '/s/first.svg' }),
    ]);
  });

  it('rejects a catalog body beyond the byte cap before parsing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`{"padding":"${'x'.repeat(4 * 1024 * 1024)}"}`, {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    expect(await fetchSymbols('http://pi')).toBeUndefined();
  });

  it('caps provider entries inspected even when none are usable', async () => {
    const body: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, index) => [`invalid-${index}`, null]),
    );
    body.last = {
      alias: ['custom:last'],
      mediaType: 'image/svg+xml',
      url: '/s/last.svg',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    expect(await fetchSymbols('http://pi')).toEqual([]);
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
