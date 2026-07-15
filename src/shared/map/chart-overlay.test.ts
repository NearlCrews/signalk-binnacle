import { describe, expect, it, vi } from 'vitest';
import { createFakeMap } from '$shared/testing';
import { createChartOverlay } from './chart-overlay';
import { registerPmtilesArchive, unregisterPmtilesArchive } from './pmtiles';
import type { OverlayContext } from './types';

vi.mock('./pmtiles', () => ({
  registerPmtilesArchive: vi.fn(),
  unregisterPmtilesArchive: vi.fn(),
}));

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

describe('chart overlay', () => {
  it('adds the chart source and layer in the basemap band', () => {
    const overlay = createChartOverlay(
      { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
      'http://pi.local',
    );
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    expect(overlay.band).toBe('basemap');
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(1);
  });

  it('exposes chart metadata for the layer list', () => {
    const overlay = createChartOverlay(
      {
        identifier: 'noaa',
        name: 'NOAA',
        type: 'tilelayer',
        tilemapUrl: '/t/{z}/{x}/{y}',
        bounds: [-10, 40, 10, 60],
      },
      'http://pi.local',
    );
    expect(overlay.description).toBe('Chart source from the Signal K server');
    expect(overlay.chart).toMatchObject({
      identifier: 'noaa',
      source: 'server',
      kind: 'raster',
      bounds: [-10, 40, 10, 60],
    });
  });

  it('remove deletes the layer and source', () => {
    const overlay = createChartOverlay(
      { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
      'http://pi.local',
    );
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.remove(ctxFor(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('setOpacity uses raster-opacity for a raster chart', () => {
    const overlay = createChartOverlay(
      { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
      'http://pi.local',
    );
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.setOpacity?.(ctxFor(map), 0.4);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      expect.stringContaining('chart-noaa'),
      'raster-opacity',
      0.4,
    );
  });

  it('setOpacity uses fill-opacity and line-opacity for a vector chart', () => {
    const overlay = createChartOverlay(
      { identifier: 'vec', name: 'Vec', type: 'tileJSON', url: '/v/tilejson.json', layers: [] },
      'http://pi.local',
    );
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.setOpacity?.(ctxFor(map), 0.5);
    expect(map.setPaintProperty).toHaveBeenCalledWith('chart-vec-water', 'fill-opacity', 0.5);
    expect(map.setPaintProperty).toHaveBeenCalledWith('chart-vec-roads', 'line-opacity', 0.5);
  });

  it('registers a PMTiles archive on add and unregisters it on remove', () => {
    const overlay = createChartOverlay(
      { identifier: 'pm', name: 'PM', type: 'tileJSON', url: 'https://x/c.pmtiles', layers: [] },
      'http://pi.local',
    );
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    expect(registerPmtilesArchive).toHaveBeenCalledWith('https://x/c.pmtiles', undefined);
    overlay.remove(ctxFor(map));
    expect(unregisterPmtilesArchive).toHaveBeenCalledWith('https://x/c.pmtiles');
  });

  it('does not touch the PMTiles registry for a plain tile-server chart', () => {
    vi.mocked(registerPmtilesArchive).mockClear();
    vi.mocked(unregisterPmtilesArchive).mockClear();
    const overlay = createChartOverlay(
      { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
      'http://pi.local',
    );
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.remove(ctxFor(map));
    expect(registerPmtilesArchive).not.toHaveBeenCalled();
    expect(unregisterPmtilesArchive).not.toHaveBeenCalled();
  });

  it('caps chart layers one zoom past the source native max, only once the source loads', () => {
    const overlay = createChartOverlay(
      {
        identifier: 'noaa',
        name: 'NOAA',
        type: 'tilelayer',
        tilemapUrl: '/t/{z}/{x}/{y}',
        maxzoom: 14,
      },
      'http://pi.local',
    );
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    // The source has not loaded (its native max zoom is not known yet), so nothing is capped and a
    // sourcedata listener is waiting.
    expect(map.setLayerZoomRange).not.toHaveBeenCalled();
    // Tiles arrive: the source reports loaded and a sourcedata event fires for it.
    const chartSource = [...map.sources.keys()][0];
    map.markSourceLoaded(chartSource);
    map.emit('sourcedata', { sourceId: chartSource, isSourceLoaded: true });
    expect(map.setLayerZoomRange).toHaveBeenCalledWith(
      expect.stringContaining('chart-noaa'),
      0,
      15,
    );
  });
});
