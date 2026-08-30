import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverStreamUrl, isInsecureTransportOrigin } from './origin';

describe('isInsecureTransportOrigin', () => {
  it('warns for non-loopback HTTP origins', () => {
    expect(isInsecureTransportOrigin('http://boat.local:3000')).toBe(true);
    expect(isInsecureTransportOrigin('http://192.168.1.10')).toBe(true);
  });

  it('does not warn for HTTPS, loopback, or malformed origins', () => {
    expect(isInsecureTransportOrigin('https://boat.local')).toBe(false);
    expect(isInsecureTransportOrigin('http://localhost:3000')).toBe(false);
    expect(isInsecureTransportOrigin('http://chart.localhost:3000')).toBe(false);
    expect(isInsecureTransportOrigin('http://localhost.:3000')).toBe(false);
    expect(isInsecureTransportOrigin('http://127.0.0.1:3000')).toBe(false);
    expect(isInsecureTransportOrigin('http://127.0.0.2:3000')).toBe(false);
    expect(isInsecureTransportOrigin('http://[::1]:3000')).toBe(false);
    expect(isInsecureTransportOrigin('not an origin')).toBe(false);
  });
});

describe('discoverStreamUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function discoveryFetch(body: unknown, status = 200): typeof fetch {
    return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
  }

  function advertised(ws: string): unknown {
    return { endpoints: { v1: { 'signalk-ws': ws } } };
  }

  it('returns the advertised wss endpoint verbatim', async () => {
    vi.stubGlobal('location', new URL('http://helm.local:3000'));
    const url = await discoverStreamUrl(
      discoveryFetch(advertised('wss://boat.example:3443/signalk/v1/stream')),
    );
    expect(url).toBe('wss://boat.example:3443/signalk/v1/stream');
  });

  it('normalizes an http endpoint to ws and resolves a relative one against the origin', async () => {
    vi.stubGlobal('location', new URL('http://helm.local:3000'));
    expect(
      await discoverStreamUrl(discoveryFetch(advertised('http://boat.example/signalk/v1/stream'))),
    ).toBe('ws://boat.example/signalk/v1/stream');
    expect(await discoverStreamUrl(discoveryFetch(advertised('/signalk/v1/stream')))).toBe(
      'ws://helm.local:3000/signalk/v1/stream',
    );
  });

  it('upgrades an insecure endpoint under an https page', async () => {
    vi.stubGlobal('location', new URL('https://helm.local'));
    const url = await discoverStreamUrl(
      discoveryFetch(advertised('ws://boat.example/signalk/v1/stream')),
    );
    expect(url).toBe('wss://boat.example/signalk/v1/stream');
  });

  it('degrades to undefined on a missing endpoint, a bad scheme, or a failed fetch', async () => {
    vi.stubGlobal('location', new URL('http://helm.local:3000'));
    expect(await discoverStreamUrl(discoveryFetch({ endpoints: {} }))).toBeUndefined();
    expect(
      await discoverStreamUrl(discoveryFetch(advertised('ftp://boat.example/stream'))),
    ).toBeUndefined();
    expect(await discoverStreamUrl(discoveryFetch({}, 500))).toBeUndefined();
    expect(await discoverStreamUrl(() => Promise.reject(new Error('offline')))).toBeUndefined();
  });
});
