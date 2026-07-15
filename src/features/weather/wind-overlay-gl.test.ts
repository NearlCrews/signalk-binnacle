import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeatherStore } from '$entities/weather';
import type { OverlayContext } from '$shared/map';
import { createFakeMap } from '$shared/testing';

const windParticles = vi.hoisted(() => ({
  setWind: vi.fn(),
}));

vi.mock('./wind-gl/wind-gl-support', () => ({
  supportsWindGl: () => true,
}));

vi.mock('./wind-gl/wind-particles', () => ({
  WindParticles: class {
    setTheme() {}
    setOpacity() {}
    setWind(field: unknown) {
      windParticles.setWind(field);
    }
    dispose() {}
  },
}));

import { createWindOverlay } from './wind-overlay';

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

function storeWithGrid(): WeatherStore {
  const store = new WeatherStore();
  store.setGrid({
    lats: [0, 1],
    lons: [0, 1],
    times: [1000],
    windU: [[-10, -10, -10, -10]],
    windV: [[0, 0, 0, 0]],
  });
  return store;
}

describe('wind overlay WebGL field', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('suppresses hidden texture generation and pushes one texture when shown', () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    const overlay = createWindOverlay(storeWithGrid());
    const map = createFakeMap();
    const canvas = new EventTarget();
    Object.assign(map, {
      getCanvas: () => canvas,
      triggerRepaint: vi.fn(),
    });
    const addLayer = map.addLayer;
    map.addLayer = ((layer: { id: string; onAdd?: (map: unknown, gl: unknown) => void }) => {
      addLayer(layer);
      layer.onAdd?.(map, {});
    }) as typeof map.addLayer;
    const ctx = ctxFor(map);

    overlay.add(ctx);
    overlay.sync(ctx);
    expect(windParticles.setWind).not.toHaveBeenCalled();

    overlay.setVisible(ctx, true);
    expect(windParticles.setWind).toHaveBeenCalledTimes(1);
    overlay.sync(ctx);
    expect(windParticles.setWind).toHaveBeenCalledTimes(1);
  });
});
