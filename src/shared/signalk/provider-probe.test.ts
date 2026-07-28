import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import { fetchProviderIdList, fetchProviderIds, safeProviderId } from './provider-probe';

const URL = 'http://boat/signalk/v2/api/resources/tracks/_providers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeProviderId', () => {
  it('accepts a bounded id and an absent optional provider', () => {
    expect(safeProviderId('signalk-questdb')).toBe(true);
    expect(safeProviderId(undefined)).toBe(true);
  });

  it('rejects empty, over-long, control-character, and prototype-shaped ids', () => {
    expect(safeProviderId('')).toBe(false);
    expect(safeProviderId('a'.repeat(129))).toBe(false);
    expect(safeProviderId('bad\u0007id')).toBe(false);
    expect(safeProviderId('__proto__')).toBe(false);
    expect(safeProviderId('constructor')).toBe(false);
    expect(safeProviderId('prototype')).toBe(false);
  });
});

describe('fetchProviderIds', () => {
  it('sends the token, orders the default provider first, and caps the list', async () => {
    const mock = stubFetch({
      ok: true,
      body: {
        'resources-provider': { isDefault: false },
        'chart-locker': { isDefault: false },
        'track-keeper': { isDefault: true },
      },
    });
    await expect(fetchProviderIds(URL, 'tok', 2)).resolves.toEqual({
      ids: ['track-keeper', 'resources-provider'],
    });
    expect(mock.mock.calls[0][0]).toBe(URL);
    expectBearerAuth(mock.mock.calls[0][1], 'tok');
  });

  it('reads an answered empty object as no registered providers', async () => {
    stubFetch({ ok: true, body: {} });
    await expect(fetchProviderIds(URL, undefined, 8)).resolves.toEqual({ ids: [] });
  });

  it('drops ids the guard rejects', async () => {
    stubFetch({
      ok: true,
      body: { good: {}, ['x'.repeat(200)]: {} },
    });
    await expect(fetchProviderIds(URL, undefined, 8)).resolves.toEqual({ ids: ['good'] });
  });

  it('reports an unanswered or malformed probe as unknown', async () => {
    stubFetch({ ok: false, status: 404 });
    await expect(fetchProviderIds(URL, undefined, 8)).resolves.toBeUndefined();
    stubFetch('reject');
    await expect(fetchProviderIds(URL, undefined, 8)).resolves.toBeUndefined();
    stubFetch({ ok: true, body: { state: 'FAILED', statusCode: 404, message: 'no provider' } });
    await expect(fetchProviderIds(URL, undefined, 8)).resolves.toBeUndefined();
    stubFetch({ ok: true, body: ['resources-provider'] });
    await expect(fetchProviderIds(URL, undefined, 8)).resolves.toBeUndefined();
  });
});

describe('fetchProviderIdList', () => {
  it('sends the token, keeps the server order, and caps the list', async () => {
    const mock = stubFetch({
      ok: true,
      body: ['resources-provider', 'chart-locker', 'track-keeper'],
    });
    await expect(fetchProviderIdList(URL, 'tok', 2)).resolves.toEqual({
      ids: ['resources-provider', 'chart-locker'],
    });
    expect(mock.mock.calls[0][0]).toBe(URL);
    expectBearerAuth(mock.mock.calls[0][1], 'tok');
  });

  it('reads an answered empty array as no registered providers', async () => {
    stubFetch({ ok: true, body: [] });
    await expect(fetchProviderIdList(URL, undefined, 8)).resolves.toEqual({ ids: [] });
  });

  it('drops ids the guard rejects', async () => {
    stubFetch({ ok: true, body: ['good', 'x'.repeat(200)] });
    await expect(fetchProviderIdList(URL, undefined, 8)).resolves.toEqual({ ids: ['good'] });
  });

  it('reports an unanswered or wrongly shaped probe as unknown', async () => {
    stubFetch({ ok: false, status: 404 });
    await expect(fetchProviderIdList(URL, undefined, 8)).resolves.toBeUndefined();
    stubFetch('reject');
    await expect(fetchProviderIdList(URL, undefined, 8)).resolves.toBeUndefined();
    // The keyed shape belongs to the history and weather APIs, so it must not satisfy this reader.
    stubFetch({ ok: true, body: { 'resources-provider': { isDefault: true } } });
    await expect(fetchProviderIdList(URL, undefined, 8)).resolves.toBeUndefined();
    stubFetch({ ok: true, body: ['resources-provider', { id: 'not a string' }] });
    await expect(fetchProviderIdList(URL, undefined, 8)).resolves.toBeUndefined();
  });
});
