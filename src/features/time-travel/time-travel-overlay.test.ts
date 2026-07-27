import { describe, expect, it, vi } from 'vitest';
import { fakeOverlayContext } from '$shared/testing';
import { createTimeTravelOverlay } from './time-travel-overlay';
import { TimeTravelStore } from './time-travel-store.svelte';

function fakeCtx() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn>; data: unknown }>();
  const layers = new Set<string>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => sources.set(id, { setData: vi.fn(), data: undefined }),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    addLayer: (layer: { id: string }) => layers.add(layer.id),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
  };
  const ctx = fakeOverlayContext(map);
  return { ctx, sources, layers };
}

function store() {
  return new TimeTravelStore(
    'http://x',
    () => undefined,
    () => ({ ids: ['p'] }),
    { load: () => Promise.resolve(undefined) },
  );
}

describe('time-travel overlay', () => {
  it('adds a marker source and circle layer', async () => {
    const { ctx, sources, layers } = fakeCtx();
    const overlay = createTimeTravelOverlay(store());
    await overlay.add(ctx);
    expect(sources.has('binnacle-time-travel-marker')).toBe(true);
    expect(layers.has('binnacle-time-travel-marker-circle')).toBe(true);
  });

  it('sync sets marker data only when the marker sample changes', async () => {
    const { ctx, sources } = fakeCtx();
    const s = store();
    s.active = true;
    s.samples = [{ t: 0, lon: 1, lat: 1 }];
    s.from = 0;
    s.to = 0;
    s.scrubMs = 0;
    const overlay = createTimeTravelOverlay(s);
    await overlay.add(ctx);
    const src = sources.get('binnacle-time-travel-marker');
    overlay.sync(ctx);
    expect(src?.setData).toHaveBeenCalledTimes(1);
    overlay.sync(ctx);
    expect(src?.setData).toHaveBeenCalledTimes(1);
    s.active = false;
    overlay.sync(ctx);
    expect(src?.setData).toHaveBeenCalledTimes(2);
  });

  it('remove cleans up the source and layer', async () => {
    const { ctx, sources, layers } = fakeCtx();
    const overlay = createTimeTravelOverlay(store());
    await overlay.add(ctx);
    overlay.remove(ctx);
    expect(sources.size).toBe(0);
    expect(layers.size).toBe(0);
  });
});
