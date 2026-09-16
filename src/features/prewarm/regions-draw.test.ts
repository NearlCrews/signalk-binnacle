import type { Map as MapLibreMap } from 'maplibre-gl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegionRectangle } from './regions-draw';

const draw = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  setMode: vi.fn(),
  addFeatures: vi.fn(() => [{ valid: true }]),
  getSnapshotFeature: vi.fn(),
}));
vi.mock('terra-draw', () => ({
  TerraDraw: vi.fn(
    class {
      constructor() {
        Object.assign(this, draw);
      }
    },
  ),
  TerraDrawRectangleMode: vi.fn(),
}));
vi.mock('terra-draw-maplibre-gl-adapter', () => ({ TerraDrawMapLibreGLAdapter: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('Offline area rectangle interaction', () => {
  it('shows a keyboard-selected area without capturing another chart click', () => {
    const rectangle = createRegionRectangle({} as MapLibreMap);
    rectangle.set([-1, -1, 1, 1]);
    expect(draw.start).toHaveBeenCalledOnce();
    expect(draw.addFeatures).toHaveBeenCalledOnce();
    expect(draw.setMode).toHaveBeenLastCalledWith('static');
    rectangle.start();
    expect(draw.start).toHaveBeenCalledOnce();
    expect(draw.setMode).toHaveBeenLastCalledWith('rectangle');
    rectangle.clear();
    expect(draw.setMode).toHaveBeenLastCalledWith('static');
    rectangle.destroy();
    expect(draw.stop).toHaveBeenCalledOnce();
  });
});
