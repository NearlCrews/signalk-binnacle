import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SkSymbol } from '$shared/signalk';
import { SymbolsStore } from './symbols-store';

function sym(overrides: Partial<SkSymbol>): SkSymbol {
  return {
    uuid: 'u1',
    aliases: ['custom:flag'],
    name: 'Flag',
    url: '/signalk/symbol-manager/symbols/u1.svg',
    roles: [],
    ...overrides,
  };
}

describe('SymbolsStore resolve', () => {
  it('resolves any qualified alias regardless of namespace, since the image is shared', () => {
    const flag = sym({ aliases: ['custom:flag', 'fsk:dive-site'] });
    const store = new SymbolsStore('http://pi', undefined, [flag]);
    expect(store.resolve('custom:flag')).toBe(flag);
    // A foreign vendor alias another app stored still renders the same shared symbol.
    expect(store.resolve('fsk:dive-site')).toBe(flag);
  });

  it('treats the binnacle namespace as the host built-in table for bare and default refs', () => {
    const dive = sym({ uuid: 'd', aliases: ['binnacle:dive-site'], roles: ['waypoint'] });
    const store = new SymbolsStore('http://pi', undefined, [dive]);
    expect(store.resolve('binnacle:dive-site')).toBe(dive); // explicit
    expect(store.resolve('dive-site')).toBe(dive); // bare id -> host built-in
    expect(store.resolve('default:dive-site')).toBe(dive); // explicit built-in -> host table
  });

  it('does not resolve a bare id against a custom symbol (custom is reached qualified)', () => {
    const flag = sym({ aliases: ['custom:flag'] });
    const store = new SymbolsStore('http://pi', undefined, [flag]);
    expect(store.resolve('custom:flag')).toBe(flag);
    expect(store.resolve('flag')).toBeUndefined();
  });

  it('renders an exact foreign alias but never substitutes for an absent reference', () => {
    const foreign = sym({ uuid: 'f', aliases: ['fsk:marina', 'garmin:Marina'] });
    const store = new SymbolsStore('http://pi', undefined, [foreign]);
    expect(store.resolve('fsk:marina')).toBe(foreign); // exact foreign alias renders
    expect(store.resolve('marina')).toBeUndefined(); // bare -> binnacle:marina -> none
    expect(store.resolve('opencpn:marina')).toBeUndefined(); // no such alias, no substitution
  });

  it('default:id resolves only within the host table, never a provider override', () => {
    // A custom dive-flag must not satisfy default:dive-flag; only binnacle:dive-flag would.
    const store = new SymbolsStore('http://pi', undefined, [
      sym({ aliases: ['custom:dive-flag'] }),
    ]);
    expect(store.resolve('default:dive-flag')).toBeUndefined();
  });

  it('filters by role when the symbol declares roles', () => {
    const noteOnly = sym({ aliases: ['binnacle:flag'], roles: ['note'] });
    const store = new SymbolsStore('http://pi', undefined, [noteOnly]);
    expect(store.resolve('flag', 'note')).toBe(noteOnly);
    expect(store.resolve('flag', 'waypoint')).toBeUndefined();
  });

  it('a symbol with no declared roles matches any role', () => {
    const store = new SymbolsStore('http://pi', undefined, [sym({ aliases: ['binnacle:flag'] })]);
    expect(store.resolve('flag', 'waypoint')).toBeDefined();
  });

  it('forRole offers only binnacle/custom symbols declaring that role', () => {
    const note = sym({ uuid: 'n', aliases: ['custom:n'], roles: ['note'] });
    const both = sym({ uuid: 'b', aliases: ['binnacle:b'], roles: ['note', 'waypoint'] });
    const none = sym({ uuid: 'x', aliases: ['custom:x'] });
    const foreign = sym({ uuid: 'f', aliases: ['fsk:wp'], roles: ['waypoint'] });
    const store = new SymbolsStore('http://pi', undefined, [note, both, none, foreign]);
    expect(store.forRole('note')).toEqual([note, both]);
    // foreign declares 'waypoint' but is not adopted (fsk), so it is not offered.
    expect(store.forRole('waypoint')).toEqual([both]);
  });

  it('keeps the first symbol when a malformed catalog repeats a uuid', () => {
    const first = sym({ aliases: ['custom:first'], url: '/s/first.svg' });
    const duplicate = sym({ aliases: ['custom:second'], url: '/s/second.svg' });
    const store = new SymbolsStore('http://pi', undefined, [first, duplicate]);

    expect(store.symbols).toEqual([first]);
    expect(store.resolve('custom:first')).toBe(first);
    expect(store.resolve('custom:second')).toBeUndefined();
  });
});

describe('SymbolsStore svgText', () => {
  afterEach(() => vi.unstubAllGlobals());

  const svgResponse = (text = '<svg xmlns="http://www.w3.org/2000/svg"/>'): Response =>
    new Response(text, { headers: { 'Content-Type': 'image/svg+xml' } });

  it('fetches the server-relative asset with auth and caches it per uuid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(svgResponse());
    vi.stubGlobal('fetch', fetchMock);
    const symbol = sym({});
    const store = new SymbolsStore('http://pi', 'tok', [symbol]);
    expect(await store.svgText(symbol)).toContain('<svg');
    expect(await store.svgText(symbol)).toContain('<svg');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi/signalk/symbol-manager/symbols/u1.svg');
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' });
  });

  it('returns undefined for a non-OK response, a non-SVG body, or a thrown fetch', async () => {
    const symbol = sym({});
    const freshText = (): Promise<string | undefined> =>
      new SymbolsStore('http://pi', undefined, [symbol]).svgText(symbol);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    expect(await freshText()).toBeUndefined();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html>nope</html>', { headers: { 'Content-Type': 'text/html' } }),
        ),
    );
    expect(await freshText()).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await freshText()).toBeUndefined();
  });

  it('refuses an absolute asset url without making a request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(svgResponse());
    vi.stubGlobal('fetch', fetchMock);
    const symbol = sym({ url: 'https://cdn.example/flag.svg' });
    expect(
      await new SymbolsStore('http://pi', undefined, [symbol]).svgText(symbol),
    ).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects active content, external references, and oversized SVG bodies', async () => {
    const symbol = sym({});
    const load = async (body: string, headers: HeadersInit = {}): Promise<string | undefined> => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(body, { headers: { 'Content-Type': 'image/svg+xml', ...headers } }),
          ),
      );
      return new SymbolsStore('http://pi', undefined, [symbol]).svgText(symbol);
    };
    expect(await load('<svg><script>alert(1)</script></svg>')).toBeUndefined();
    expect(
      await load(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/2000/svg"><x:foreignObject/></svg>',
      ),
    ).toBeUndefined();
    expect(
      await load(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/2000/svg"><x:script/></svg>',
      ),
    ).toBeUndefined();
    expect(await load('<svg><use href="https://evil.example/a.svg#x"/></svg>')).toBeUndefined();
    expect(
      await load(
        '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://evil.example/a.svg#x"/></svg>',
      ),
    ).toBeUndefined();
    expect(await load('<svg><use href=https://evil.example/a.svg#x /></svg>')).toBeUndefined();
    expect(await load('<svg><feImage href="https://evil.example/a.svg"/></svg>')).toBeUndefined();
    expect(
      await load('<svg><style>.x{fill:url(https\\3a //evil.example/x)}</style></svg>'),
    ).toBeUndefined();
    expect(
      await load('<svg><style>.x{fill:url("https://evil.example/a b")}</style></svg>'),
    ).toBeUndefined();
    expect(await load('<svg><path onclick="alert(1)"/></svg>')).toBeUndefined();
    expect(
      await load(
        '<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://evil.example/"><use href="#mark"/></svg>',
      ),
    ).toBeUndefined();
    expect(await load(`<svg>${' '.repeat(256 * 1024)}</svg>`)).toBeUndefined();
  });

  it('drops cached SVG text when the authentication token changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(svgResponse());
    vi.stubGlobal('fetch', fetchMock);
    const symbol = sym({});
    const store = new SymbolsStore('http://pi', 'old-token', [symbol]);

    await store.svgText(symbol);
    store.setAuth('new-token');
    await store.svgText(symbol);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer new-token' },
    });
  });
});
