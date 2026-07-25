import { describe, expect, it, vi } from 'vitest';
import { PersistedValue } from '$shared/settings';
import { createFakeStorage } from '$shared/testing';
import { modeFromPreset, UnitsStore } from './units.svelte';

const imperialPreset = { categories: { length: { targetUnit: 'foot' } } };
const metricPreset = { categories: { length: { targetUnit: 'm' } } };

function localSetting(seed?: Record<string, string>) {
  return new PersistedValue<'metric' | 'imperial'>(
    'binnacle:units',
    'metric',
    createFakeStorage(seed),
  );
}

function fetchStub(routes: Record<string, unknown>): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const key = Object.keys(routes).find((path) => String(url).includes(path));
    if (!key) return { ok: false, json: async () => ({}) } as Response;
    return { ok: true, json: async () => routes[key] } as Response;
  }) as typeof fetch;
}

describe('modeFromPreset', () => {
  it('reads imperial from a foot length and metric from meters', () => {
    expect(modeFromPreset(imperialPreset)).toBe('imperial');
    expect(modeFromPreset(metricPreset)).toBe('metric');
  });

  it('falls back to depth, then temperature, and reports unknown shapes as undefined', () => {
    expect(modeFromPreset({ categories: { depth: { targetUnit: 'foot' } } })).toBe('imperial');
    expect(modeFromPreset({ categories: { temperature: { targetUnit: 'F' } } })).toBe('imperial');
    expect(modeFromPreset({ categories: {} })).toBeUndefined();
    expect(modeFromPreset(undefined)).toBeUndefined();
  });
});

describe('UnitsStore', () => {
  it('prefers the per-user preset over the global active one', async () => {
    const units = new UnitsStore(localSetting());
    await units.syncFromServer(
      'http://pi',
      fetchStub({
        '/applicationData/user/unitpreferences': { activePreset: 'imperial-us' },
        '/unitpreferences/presets/imperial-us': imperialPreset,
        '/unitpreferences/active': metricPreset,
      }),
    );
    expect(units.mode).toBe('imperial');
    expect(units.source).toBe('server');
  });

  it('uses the global active preset when no user preference exists', async () => {
    const units = new UnitsStore(localSetting());
    await units.syncFromServer(
      'http://pi',
      fetchStub({ '/unitpreferences/active': imperialPreset }),
    );
    expect(units.mode).toBe('imperial');
  });

  it('keeps the local setting when the server has no unit preferences (older server)', async () => {
    const units = new UnitsStore(localSetting({ 'binnacle:units': '"imperial"' }));
    await units.syncFromServer('http://pi', fetchStub({}));
    expect(units.mode).toBe('imperial');
    expect(units.source).toBe('local');
  });

  it('a transport failure cannot flip an already resolved server mode', async () => {
    const units = new UnitsStore(localSetting());
    await units.syncFromServer(
      'http://pi',
      fetchStub({ '/unitpreferences/active': imperialPreset }),
    );
    await units.syncFromServer('http://pi', fetchStub({}));
    expect(units.mode).toBe('imperial');
  });

  it('ignores an older same-origin resolution that finishes after a newer one', async () => {
    let resolveOlder!: (response: Response) => void;
    const olderActive = new Promise<Response>((resolve) => {
      resolveOlder = resolve;
    });
    const olderFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockReturnValueOnce(olderActive);
    const units = new UnitsStore(localSetting());

    const older = units.syncFromServer('http://pi', olderFetch);
    await Promise.resolve();
    await units.syncFromServer('http://pi', fetchStub({ '/unitpreferences/active': metricPreset }));
    resolveOlder({ ok: true, json: async () => imperialPreset } as Response);
    await older;

    expect(units.mode).toBe('metric');
    expect(units.source).toBe('server');
  });

  it('ignores a response from the previously selected server origin', async () => {
    let resolveOlder!: (response: Response) => void;
    const olderActive = new Promise<Response>((resolve) => {
      resolveOlder = resolve;
    });
    const olderFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockReturnValueOnce(olderActive);
    const units = new UnitsStore(localSetting());

    const older = units.syncFromServer('http://old-pi', olderFetch);
    await Promise.resolve();
    await units.syncFromServer(
      'http://new-pi',
      fetchStub({ '/unitpreferences/active': metricPreset }),
    );
    resolveOlder({ ok: true, json: async () => imperialPreset } as Response);
    await older;

    expect(units.mode).toBe('metric');
    expect(units.source).toBe('server');
  });
});
