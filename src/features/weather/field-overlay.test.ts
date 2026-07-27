import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createFieldOverlay } from './field-overlay';

function storeWithGrid(): WeatherStore {
  const store = new WeatherStore();
  store.setGrid({
    lats: [0, 1],
    lons: [0, 1],
    times: [1000],
    windU: [[0, 0, 0, 0]],
    windV: [[0, 0, 0, 0]],
  });
  return store;
}

function canvasWithContext(): HTMLCanvasElement {
  const context = {
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: vi.fn(),
    clearRect: vi.fn(),
  };
  return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
}

describe('field overlay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('suppresses hidden field generation and synchronizes once when shown', async () => {
    const store = storeWithGrid();
    const fieldRgba = vi.fn(() => ({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16),
    }));
    const overlay = createFieldOverlay(
      store,
      {
        id: 'test-field',
        title: 'Test field',
        sourceId: 'test-field-source',
        layerId: 'test-field-layer',
        fieldRgba,
      },
      canvasWithContext,
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    overlay.sync(ctx);
    expect(fieldRgba).not.toHaveBeenCalled();

    overlay.setVisible(ctx, true);
    expect(fieldRgba).toHaveBeenCalledTimes(1);
    overlay.sync(ctx);
    expect(fieldRgba).toHaveBeenCalledTimes(1);

    overlay.setVisible(ctx, false);
    store.setSelectedTime(2_000);
    overlay.sync(ctx);
    expect(fieldRgba).toHaveBeenCalledTimes(1);

    overlay.setVisible(ctx, true);
    expect(fieldRgba).toHaveBeenCalledTimes(2);
  });

  it('cancels its refresh frame and avoids map access after removal', async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const request = vi.fn((callback: FrameRequestCallback) => {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    });
    const cancel = vi.fn((id: number) => callbacks.delete(id));
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);

    const overlay = createFieldOverlay(
      storeWithGrid(),
      {
        id: 'test-field',
        title: 'Test field',
        sourceId: 'test-field-source',
        layerId: 'test-field-layer',
        fieldRgba: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
      },
      canvasWithContext,
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    const source = map.sources.get('test-field-source') as typeof map.sources extends Map<
      string,
      infer T
    >
      ? T & { play: () => void; pause: () => void }
      : never;
    source.play = vi.fn();
    source.pause = vi.fn();
    const getSource = vi.spyOn(map, 'getSource');

    overlay.setVisible(ctx, true);
    expect(request).toHaveBeenCalledTimes(1);
    const queued = [...callbacks.values()][0];
    overlay.remove(ctx);
    overlay.remove(ctx);
    const callsAfterRemove = getSource.mock.calls.length;

    expect(cancel).toHaveBeenCalledTimes(1);
    queued?.(0);
    expect(getSource).toHaveBeenCalledTimes(callsAfterRemove);
    expect(source.pause).not.toHaveBeenCalled();
  });

  it('absorbs a visibility or opacity change that lands before add attaches the layer', async () => {
    const overlay = createFieldOverlay(
      storeWithGrid(),
      {
        id: 'test-field',
        title: 'Test field',
        sourceId: 'test-field-source',
        layerId: 'test-field-layer',
        fieldRgba: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
      },
      canvasWithContext,
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    expect(() => overlay.setVisible(ctx, true)).not.toThrow();
    expect(() => overlay.setOpacity?.(ctx, 0.3)).not.toThrow();
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
    expect(map.setPaintProperty).not.toHaveBeenCalled();

    await overlay.add(ctx);
    overlay.setVisible(ctx, true);
    overlay.setOpacity?.(ctx, 0.3);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('test-field-layer', 'visibility', 'visible');
    expect(map.setPaintProperty).toHaveBeenCalledWith('test-field-layer', 'raster-opacity', 0.3);
  });
});
