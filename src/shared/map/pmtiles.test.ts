import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionSource, createArchiveSource, NoStoreSource } from './pmtiles';
import { BlockCachedSource } from './pmtiles-block-cache';

function response(status: number, bytes = 4, start = 0): Response {
  return {
    status,
    headers: new Headers(
      status === 206
        ? { 'Content-Range': `bytes ${start}-${start + bytes - 1}/${start + bytes}` }
        : {},
    ),
    arrayBuffer: async () => new ArrayBuffer(bytes),
  } as unknown as Response;
}

describe('NoStoreSource.getBytes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries a transient network error then resolves', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(response(206));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.data.byteLength).toBe(4);
  });

  it('retries a 5xx then resolves', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(206));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.data.byteLength).toBe(4);
  });

  it('does not retry a 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(404));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a caller abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4, controller.signal),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('strips a weak ETag, which cannot validate range requests', async () => {
    const res = {
      status: 206,
      headers: new Headers({ ETag: 'W/"v1"', 'Content-Range': 'bytes 0-3/4' }),
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
    const out = await new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4);
    expect(out.etag).toBeUndefined();
  });

  it('passes a strong ETag through for range validation', async () => {
    const res = {
      status: 206,
      headers: new Headers({ ETag: '"v1"', 'Content-Range': 'bytes 0-3/4' }),
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
    const out = await new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4);
    expect(out.etag).toBe('"v1"');
  });

  it('rejects a server that ignores a nonzero range request', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(64));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'Content-Length': '64' }),
        arrayBuffer,
      } as unknown as Response),
    );
    await expect(new NoStoreSource('http://x/a.pmtiles').getBytes(64, 4)).rejects.toThrow(
      'ignored',
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared body before reading it', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(64));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'Content-Length': '64' }),
        arrayBuffer,
      } as unknown as Response),
    );
    await expect(new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4)).rejects.toThrow(
      'declared',
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects a partial response without matching Content-Range bounds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(206, 4, 8)));
    await expect(new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4)).rejects.toThrow('outside');
  });

  it('rejects a short partial response before the archive end', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 206,
        headers: new Headers({ 'Content-Range': 'bytes 0-3/100' }),
        arrayBuffer: async () => new ArrayBuffer(4),
      } as unknown as Response),
    );

    await expect(new NoStoreSource('http://x/a.pmtiles').getBytes(0, 8)).rejects.toThrow('outside');
  });

  it('accepts a short partial response only at the archive end', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(206, 4, 100)));

    await expect(new NoStoreSource('http://x/a.pmtiles').getBytes(100, 512)).resolves.toMatchObject(
      { data: expect.any(ArrayBuffer) },
    );
  });

  it('rejects a malformed Content-Length header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 206,
        headers: new Headers({
          'Content-Range': 'bytes 0-3/4',
          'Content-Length': 'not-a-number',
        }),
        arrayBuffer: async () => new ArrayBuffer(4),
      } as unknown as Response),
    );

    await expect(new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4)).rejects.toThrow(
      'invalid response length',
    );
  });

  it('derives an archive validator from Last-Modified and total size', async () => {
    const res = response(206);
    res.headers.set('Last-Modified', 'Wed, 15 Jul 2026 12:00:00 GMT');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
    const out = await new NoStoreSource('http://x/a.pmtiles').getBytes(0, 4);
    expect(out.etag).toBe('binnacle:Wed, 15 Jul 2026 12:00:00 GMT:4');
  });
});

describe('createArchiveSource', () => {
  it('wraps a network archive in the block cache, keyed by the bare url', () => {
    const source = createArchiveSource('http://x/a.pmtiles');
    expect(source).toBeInstanceOf(BlockCachedSource);
    expect(source.getKey()).toBe('http://x/a.pmtiles');
  });

  it('leaves a blob: archive uncached, since its bytes are already local', () => {
    const source = createArchiveSource('blob:http://x/123');
    expect(source).toBeInstanceOf(NoStoreSource);
    expect(source.getKey()).toBe('blob:http://x/123');
  });
});

describe('createArchiveSource provided-path switch', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { href: 'http://localhost/', hostname: 'localhost', origin: 'http://localhost' },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses a CompanionSource for a companion-provided archive (dynamic auth, browser cache)', () => {
    const source = createArchiveSource(
      `${window.location.origin}/plugins/signalk-chart-locker/pmtiles/sf.pmtiles`,
      () => 'tok',
    );
    expect(source).toBeInstanceOf(CompanionSource);
  });

  it('does not treat a different-host url with the companion path as companion-provided', () => {
    const source = createArchiveSource(
      'https://evil.example.com/plugins/signalk-chart-locker/pmtiles/sf.pmtiles',
    );
    expect(source).toBeInstanceOf(BlockCachedSource);
  });

  it('does not treat a same-host-different-port url as companion-provided', () => {
    const source = createArchiveSource(
      'http://localhost:9000/plugins/signalk-chart-locker/pmtiles/sf.pmtiles',
    );
    expect(source).toBeInstanceOf(BlockCachedSource);
  });

  it('keeps NoStoreSource for a blob archive', () => {
    const source = createArchiveSource('blob:http://localhost/abc-123');
    expect(source).toBeInstanceOf(NoStoreSource);
  });

  it('keeps the block-cached no-store source for any other network archive', () => {
    const source = createArchiveSource('https://charts.example.com/world.pmtiles');
    expect(source).toBeInstanceOf(BlockCachedSource);
  });

  it('does not treat a remote url that merely contains the prefix as a different segment', () => {
    const source = createArchiveSource(
      'https://evil.example.com/x/plugins/signalk-chart-locker/pmtilesX/a.pmtiles',
    );
    expect(source).toBeInstanceOf(BlockCachedSource);
  });
});

describe('CompanionSource.getBytes auth header', () => {
  const COMPANION_URL = 'http://localhost/plugins/signalk-chart-locker/pmtiles/sf.pmtiles';

  const okResponse = (start = 0): Response => response(206, 4, start);

  afterEach(() => vi.unstubAllGlobals());

  it('includes Authorization header when token is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    await new CompanionSource(COMPANION_URL, () => 'test-token').getBytes(0, 4);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });

  it('reads the token dynamically so a later token change is picked up', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    let token: string | undefined;
    const source = new CompanionSource(COMPANION_URL, () => token);
    await source.getBytes(0, 4);
    const call0 = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(call0.Authorization).toBeUndefined();
    token = 'new-token';
    await source.getBytes(0, 4);
    const call1 = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(call1.Authorization).toBe('Bearer new-token');
  });

  it('omits Authorization when no token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    await new CompanionSource(COMPANION_URL, () => undefined).getBytes(0, 4);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('always includes the Range header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(100));
    vi.stubGlobal('fetch', fetchMock);
    await new CompanionSource(COMPANION_URL, () => 'tok').getBytes(100, 512);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Range).toBe('bytes=100-611');
  });

  it('rejects a response whose final URL crossed origins', async () => {
    const redirected = okResponse();
    Object.defineProperty(redirected, 'url', { value: 'http://attacker.test/a.pmtiles' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirected));

    await expect(new CompanionSource(COMPANION_URL, () => 'tok').getBytes(0, 4)).rejects.toThrow(
      'outside',
    );
  });
});
