import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing/fetch-stub';
import { fetchPathMeta, type MetaZone, zoneStateFor } from './meta';

const ZONES: MetaZone[] = [
  { upper: 3, state: 'alarm', message: 'Shallow' },
  { lower: 3, upper: 5, state: 'warn' },
  { lower: 5, upper: 100, state: 'normal' },
];

describe('zoneStateFor', () => {
  it('bands a value inside an alarm zone', () => {
    expect(zoneStateFor(2, ZONES)).toBe('alarm');
  });
  it('maps warn to warning', () => {
    expect(zoneStateFor(4, ZONES)).toBe('warning');
  });
  it('maps alert to warning and emergency to alarm', () => {
    expect(zoneStateFor(1, [{ upper: 2, state: 'alert' }])).toBe('warning');
    expect(zoneStateFor(1, [{ upper: 2, state: 'emergency' }])).toBe('alarm');
  });
  it('treats values outside every zone as normal per spec', () => {
    expect(zoneStateFor(200, ZONES)).toBe('normal');
  });
  it('is normal for nominal zones, no zones, empty zones, and undefined values', () => {
    expect(zoneStateFor(4, [{ lower: 0, upper: 10, state: 'nominal' }])).toBe('normal');
    expect(zoneStateFor(4, undefined)).toBe('normal');
    expect(zoneStateFor(4, [])).toBe('normal');
    expect(zoneStateFor(undefined, ZONES)).toBe('normal');
  });
  it('handles an unbounded zone (no lower, no upper) and picks the worst matching band', () => {
    expect(zoneStateFor(4, [{ state: 'warn' }])).toBe('warning');
    expect(
      zoneStateFor(4, [
        { lower: 0, upper: 10, state: 'warn' },
        { lower: 3, upper: 5, state: 'alarm' },
      ]),
    ).toBe('alarm');
  });
});

describe('fetchPathMeta', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('GETs the dots-to-slashes meta URL with the bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { zones: ZONES, units: 'm' }));
    vi.stubGlobal('fetch', fetchMock);
    const meta = await fetchPathMeta('http://pi', 'tok', 'environment.depth.belowTransducer');
    expect(meta?.zones).toHaveLength(3);
    const [url, init] = fetchMock.mock.calls[0];
    const expectedUrl =
      'http://pi/signalk/v1/api/vessels/self/environment/depth/belowTransducer/meta';
    expect(url).toBe(expectedUrl);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });
  it('resolves undefined on 401, 404, and network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, {})));
    expect(await fetchPathMeta('http://pi', undefined, 'a.b')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await fetchPathMeta('http://pi', undefined, 'a.b')).toBeUndefined();
  });
  it('resolves undefined for a non-object body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, 3)));
    expect(await fetchPathMeta('http://pi', undefined, 'a.b')).toBeUndefined();
  });
});
