import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnVessel } from '$entities/vessel';
import { mapThemePaint, type OverlayContext } from '$shared/map';
import { SignalKStore } from '$shared/signalk';
import { createFakeMap } from '$shared/testing';
import { createVesselOverlay } from './vessel-overlay';

// ImageData is a browser global; the overlay builds the vessel icon with it, so the
// node test environment needs a minimal stand-in.
class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

beforeEach(() => {
  vi.stubGlobal('ImageData', FakeImageData);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

describe('vessel overlay', () => {
  it('adds an image, a source, and a symbol layer', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(ctxFor(map));
    expect(map.images.size).toBe(1);
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(1);
  });

  it('updates the source position from the store', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(ctxFor(map));
    store.applyFrame({
      self: new Map<string, unknown>([
        ['navigation.position', { latitude: 36.8, longitude: -121.7 }],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1,
    });
    overlay.sync(ctxFor(map));
    const source = [...map.sources.values()][0];
    const fc = source.data as { features: Array<{ geometry: { coordinates: number[] } }> };
    expect(fc.features[0].geometry.coordinates).toEqual([-121.7, 36.8]);
  });

  it('applyTheme recolors the icon image', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(ctxFor(map));
    overlay.applyTheme?.(ctxFor(map), mapThemePaint('night-red'));
    expect(map.updatedImages).toContain('binnacle-vessel');
  });

  it('remove deletes the layer and source', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(ctxFor(map));
    overlay.remove(ctxFor(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });
});
