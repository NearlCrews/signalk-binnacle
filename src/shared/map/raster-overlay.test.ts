import { describe, expect, it } from 'vitest';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
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
