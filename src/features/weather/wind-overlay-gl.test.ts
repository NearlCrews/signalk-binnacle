import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';

const windParticles = vi.hoisted(() => ({
  render: vi.fn(),
  setWind: vi.fn(),
}));

vi.mock('./wind-gl/wind-gl-support', () => ({
  supportsWindGl: () => true,
}));

vi.mock('./wind-gl/wind-particles', () => ({
  WindParticles: class {
    render(...args: unknown[]) {
      windParticles.render(...args);
    }
    setTheme() {}
    setOpacity() {}
    setWind(field: unknown) {
      windParticles.setWind(field);
    }
    dispose() {}
  },
}));

import { createWindOverlay } from './wind-overlay';

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
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('suppresses hidden texture generation and pushes one texture when shown', async () => {
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
    const ctx = fakeOverlayContext(map);

    await overlay.add(ctx);
    overlay.sync(ctx);
    expect(windParticles.setWind).not.toHaveBeenCalled();

    overlay.setVisible(ctx, true);
    expect(windParticles.setWind).toHaveBeenCalledTimes(1);
    overlay.sync(ctx);
    expect(windParticles.setWind).toHaveBeenCalledTimes(1);
  });

  it('passes the default projection matrix to the renderer without early conversion', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    const overlay = createWindOverlay(storeWithGrid());
    const map = createFakeMap();
    const canvas = new EventTarget();
    Object.assign(map, {
      getCanvas: () => canvas,
      triggerRepaint: vi.fn(),
    });
    const addLayer = map.addLayer;
    let customLayer:
      | {
          id: string;
          onAdd?: (map: unknown, gl: unknown) => void;
          render?: (gl: unknown, args: unknown) => void;
        }
      | undefined;
    map.addLayer = ((layer: typeof customLayer & { id: string }) => {
      addLayer(layer);
      customLayer = layer;
      layer.onAdd?.(map, {});
    }) as typeof map.addLayer;
    const ctx = fakeOverlayContext(map);

    await overlay.add(ctx);
    overlay.setVisible(ctx, true);

    const matrix = new Float64Array(Array.from({ length: 16 }, (_, index) => index + 0.123456789));
    customLayer?.render?.(
      { drawingBufferWidth: 1280, drawingBufferHeight: 720 },
      {
        defaultProjectionData: { mainMatrix: matrix },
        modelViewProjectionMatrix: new Float64Array(16).fill(99),
      },
    );

    expect(windParticles.render).toHaveBeenCalledWith(matrix, 1280, 720, true);
  });
});
