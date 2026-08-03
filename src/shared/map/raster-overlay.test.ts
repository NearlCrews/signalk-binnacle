import { describe, expect, it } from 'vitest';
import { createFakeMap, declaredSource, fakeOverlayContext } from '$shared/testing';
import {
  createRasterOverlay,
  RASTER_ID_PREFIX,
  type RasterOverlaySource,
  wmsTiles,
} from './raster-overlay';
import type { OverlayContext } from './types';

const fakeCtx = (): OverlayContext => fakeOverlayContext(createFakeMap());

const source: RasterOverlaySource = {
  id: 'demo',
  title: 'Demo',
  tiles: ['https://example.com/{z}/{x}/{y}.png'],
  attribution: 'Demo',
};

describe('createRasterOverlay', () => {
  it('carries the given band and prefixes the managed layer id', () => {
    const overlay = createRasterOverlay(source, 'safety');
    expect(overlay.band).toBe('safety');
    expect(overlay.layerIds[0].startsWith(RASTER_ID_PREFIX)).toBe(true);
    expect(overlay.supportsOpacity).toBe(true);
  });

  it('defaults to hidden and full opacity', () => {
    const overlay = createRasterOverlay(source, 'weather');
    expect(overlay.defaultVisible).toBe(false);
    expect(overlay.defaultOpacity).toBe(1);
  });

  it('honors an explicit defaultVisible and passes parent and group through', () => {
    const overlay = createRasterOverlay(
      { ...source, defaultVisible: true, parent: 'base', group: { id: 'g', title: 'Group' } },
      'overlay-top',
    );
    expect(overlay.defaultVisible).toBe(true);
    expect(overlay.parent).toBe('base');
    expect(overlay.group).toEqual({ id: 'g', title: 'Group' });
  });

  it('adds the prefixed raster source and layer on add', async () => {
    const ctx = fakeCtx();
    const overlay = createRasterOverlay(source, 'bathymetry');
    await overlay.add(ctx);
    expect(ctx.map.getSource(`${RASTER_ID_PREFIX}demo`)).toBeTruthy();
    expect(ctx.map.getLayer(`${RASTER_ID_PREFIX}demo-layer`)).toBeTruthy();
  });

  // Every catalog-backed overlay (seamark, boundaries, seabed infrastructure, protected areas)
  // reaches MapLibre through this one function, so a dropped upstream fact would show here. The
  // runtime source cannot answer it: MapLibre pins a tile source's maxzoom to its constructor
  // default until the declared option is applied asynchronously, so this reads what was declared.
  it('declares the zoom range and tile size on the map, not just on the descriptor', async () => {
    const map = createFakeMap();
    const overlay = createRasterOverlay(
      { ...source, tileSize: 512, minzoom: 3, maxzoom: 18 },
      'safety',
    );
    await overlay.add(fakeOverlayContext(map));
    expect(declaredSource(map, `${RASTER_ID_PREFIX}demo`)).toMatchObject({
      type: 'raster',
      tileSize: 512,
      minzoom: 3,
      maxzoom: 18,
    });
  });

  it('omits an undeclared zoom range rather than inventing one', async () => {
    const map = createFakeMap();
    await createRasterOverlay(source, 'safety').add(fakeOverlayContext(map));
    const spec = declaredSource(map, `${RASTER_ID_PREFIX}demo`);
    expect(spec.minzoom).toBeUndefined();
    expect(spec.maxzoom).toBeUndefined();
    // The catalog default, applied here rather than left for MapLibre to guess.
    expect(spec.tileSize).toBe(256);
  });
});

describe('wmsTiles', () => {
  it('builds a WMS GetMap template with the bbox token and the given layers', () => {
    const url = wmsTiles('https://host/wms', 'layerA');
    expect(url).toContain('REQUEST=GetMap');
    expect(url).toContain('LAYERS=layerA');
    expect(url).toContain('BBOX={bbox-epsg-3857}');
    expect(url.endsWith('STYLES=')).toBe(true);
  });

  it('appends a non-default style when given', () => {
    expect(wmsTiles('https://host/wms', 'layerA', 'styleB')).toContain('STYLES=styleB');
  });
});
