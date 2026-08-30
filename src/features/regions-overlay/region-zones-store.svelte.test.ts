import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '$shared/testing';
import { createRegionZonesStore } from './region-zones-store.svelte';

function keyedRegion(name: string): Record<string, unknown> {
  return {
    r1: {
      name,
      feature: {
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      },
    },
  };
}

function makeStore() {
  return createRegionZonesStore({ origin: 'http://sk', getToken: () => 'tok' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createRegionZonesStore', () => {
  it('loads once on ensureLoaded and not again while ready', async () => {
    const mock = stubFetch({ ok: true, body: keyedRegion('Race area') });
    const store = makeStore();
    expect(store.state).toBe('idle');
    await store.ensureLoaded();
    expect(store.state).toBe('ready');
    expect(store.regions).toHaveLength(1);
    await store.ensureLoaded();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('refresh is a no-op before anything asked for the zones', async () => {
    const mock = stubFetch({ ok: true, body: {} });
    const store = makeStore();
    await store.refresh();
    expect(mock).not.toHaveBeenCalled();
    expect(store.state).toBe('idle');
  });

  it('keeps shown zones through a transient refresh failure', async () => {
    stubFetch({ ok: true, body: keyedRegion('Race area') });
    const store = makeStore();
    await store.ensureLoaded();
    stubFetch('reject');
    await store.refresh();
    expect(store.state).toBe('ready');
    expect(store.regions).toHaveLength(1);
  });

  it('clears the zones when the server says the resource is gone', async () => {
    stubFetch({ ok: true, body: keyedRegion('Race area') });
    const store = makeStore();
    await store.ensureLoaded();
    stubFetch({ ok: false, status: 404 });
    await store.refresh();
    expect(store.state).toBe('unavailable');
    expect(store.regions).toHaveLength(0);
  });

  it('reports error with nothing to show and retries on the next ensureLoaded', async () => {
    stubFetch('reject');
    const store = makeStore();
    await store.ensureLoaded();
    expect(store.state).toBe('error');
    const mock = stubFetch({ ok: true, body: keyedRegion('Race area') });
    await store.ensureLoaded();
    expect(mock).toHaveBeenCalled();
    expect(store.state).toBe('ready');
  });

  it('applies only the latest of two overlapping refreshes', async () => {
    const answers: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve))),
    );
    const store = makeStore();
    const first = store.ensureLoaded();
    const second = store.refresh();
    expect(answers).toHaveLength(2);
    // The newer request lands first; the older settling afterward must not overwrite it.
    answers[1](jsonResponse(200, keyedRegion('Newest')));
    await second;
    answers[0](jsonResponse(200, keyedRegion('Stale')));
    await first;
    expect(store.regions[0]?.name).toBe('Newest');
    expect(store.state).toBe('ready');
  });
});
