import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import { fetchServerFeatures } from './features-client';

const BASE = 'https://boat.example';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchServerFeatures', () => {
  it('requests the enabled features with the bearer token', async () => {
    const mock = stubFetch({ ok: true, body: { apis: [], plugins: [] } });
    await fetchServerFeatures(BASE, 'tok');
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/signalk/v2/features?enabled=1`);
    expectBearerAuth(init, 'tok');
  });

  it('maps the apis to a set and the plugins to an id-to-version map', async () => {
    stubFetch({
      ok: true,
      body: {
        apis: ['resources', 'course', 'notifications'],
        plugins: [
          { id: 'anchoralarm', name: 'Anchor Alarm', version: '1.2.3', enabled: true },
          { id: 'derived-data', version: '4.0.0', enabled: true },
        ],
      },
    });
    const features = await fetchServerFeatures(BASE);
    expect(features?.apis.has('notifications')).toBe(true);
    expect(features?.apis.size).toBe(3);
    expect(features?.plugins.get('anchoralarm')).toBe('1.2.3');
    expect(features?.plugins.get('derived-data')).toBe('4.0.0');
  });

  it('returns undefined on a 404 from an older server', async () => {
    stubFetch({ ok: false });
    await expect(fetchServerFeatures(BASE)).resolves.toBeUndefined();
  });

  it('returns undefined on a transport failure instead of throwing', async () => {
    stubFetch('reject');
    await expect(fetchServerFeatures(BASE)).resolves.toBeUndefined();
  });

  it('tolerates a malformed body, keeping only the well-formed entries', async () => {
    stubFetch({
      ok: true,
      body: { apis: ['course', 7], plugins: [{ id: 'ok' }, { version: 'no-id' }, null, 'junk'] },
    });
    const features = await fetchServerFeatures(BASE);
    expect([...(features?.apis ?? [])]).toEqual(['course']);
    expect(features?.plugins.get('ok')).toBe('');
    expect(features?.plugins.size).toBe(1);
  });
});
