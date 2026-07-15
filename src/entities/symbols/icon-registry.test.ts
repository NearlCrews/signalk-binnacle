import { describe, expect, it, vi } from 'vitest';
import { mapThemePaint } from '$shared/map';
import type { SkSymbol } from '$shared/signalk';
import { createFakeMap } from '$shared/testing';
import { SymbolIconRegistry, symbolIconId } from './icon-registry';
import type { SymbolRaster } from './symbol-raster';

const DAY = mapThemePaint('day');
const NIGHT = mapThemePaint('night-red');

function sym(overrides: Partial<SkSymbol> = {}): SkSymbol {
  return {
    uuid: 'u1',
    aliases: ['custom:flag'],
    name: 'Flag',
    url: '/s/u1.svg',
    roles: ['note'],
    ...overrides,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function fakeRaster(cssWidth = 24, cssHeight = 24, scale = 1): SymbolRaster {
  return {
    image: { width: cssWidth * 2, height: cssHeight * 2, data: new Uint8ClampedArray(4) } as never,
    cssWidth,
    cssHeight,
    scale,
  };
}

describe('SymbolIconRegistry', () => {
  it('registers the image and exposes the entry with the anchor offset', async () => {
    const rasterize = vi.fn().mockResolvedValue(fakeRaster(24, 24, 1));
    const registry = new SymbolIconRegistry({ rasterize, svgText: async () => '<svg/>' });
    const map = createFakeMap();
    const symbol = sym({ anchor: [12, 24] });
    expect(await registry.ensure(map as never, symbol, DAY)).toBe(true);
    expect(map.hasImage(symbolIconId('u1'))).toBe(true);
    expect(registry.entry('u1')).toEqual({ iconId: 'binnacle-symbol-u1', offset: [0, -12] });
    expect(rasterize).toHaveBeenCalledWith('<svg/>', 1, DAY);
  });

  it('shares one load across concurrent ensures and no-ops once ready', async () => {
    const rasterize = vi.fn().mockResolvedValue(fakeRaster());
    const svgText = vi.fn().mockResolvedValue('<svg/>');
    const registry = new SymbolIconRegistry({ rasterize, svgText });
    const map = createFakeMap();
    const symbol = sym();
    await Promise.all([
      registry.ensure(map as never, symbol, DAY),
      registry.ensure(map as never, symbol, DAY),
    ]);
    await registry.ensure(map as never, symbol, DAY);
    expect(svgText).toHaveBeenCalledTimes(1);
    expect(rasterize).toHaveBeenCalledTimes(1);
  });

  it('reloads a ready symbol whose image was dropped by a style swap', async () => {
    const rasterize = vi.fn().mockResolvedValue(fakeRaster());
    const registry = new SymbolIconRegistry({ rasterize, svgText: async () => '<svg/>' });
    const map = createFakeMap();
    const symbol = sym();
    await registry.ensure(map as never, symbol, DAY);
    map.removeImage(symbolIconId('u1'));
    expect(await registry.ensure(map as never, symbol, DAY)).toBe(true);
    expect(map.hasImage(symbolIconId('u1'))).toBe(true);
    expect(rasterize).toHaveBeenCalledTimes(2);
  });

  it('marks a failed load and degrades without retrying', async () => {
    const svgText = vi.fn().mockResolvedValue(undefined);
    const registry = new SymbolIconRegistry({ rasterize: vi.fn(), svgText });
    const map = createFakeMap();
    const symbol = sym();
    expect(await registry.ensure(map as never, symbol, DAY)).toBe(false);
    expect(registry.status('u1')).toBe('failed');
    expect(registry.entry('u1')).toBeUndefined();
    expect(await registry.ensure(map as never, symbol, DAY)).toBe(false);
    expect(svgText).toHaveBeenCalledTimes(1);
  });

  it('marks a failed rasterization (the node path) as failed', async () => {
    const registry = new SymbolIconRegistry({
      rasterize: vi.fn().mockResolvedValue(null),
      svgText: async () => '<svg/>',
    });
    expect(await registry.ensure(createFakeMap() as never, sym(), DAY)).toBe(false);
    expect(registry.status('u1')).toBe('failed');
  });

  it('retheme re-rasterizes ready symbols with the new paint', async () => {
    const rasterize = vi.fn().mockResolvedValue(fakeRaster());
    const registry = new SymbolIconRegistry({ rasterize, svgText: async () => '<svg/>' });
    const map = createFakeMap();
    await registry.ensure(map as never, sym(), DAY);
    registry.retheme(map as never, NIGHT);
    await settle();
    expect(rasterize).toHaveBeenLastCalledWith('<svg/>', 1, NIGHT);
    expect(map.updatedImages).toContain(symbolIconId('u1'));
  });

  it('a failed retheme keeps the previous image and ready status', async () => {
    const rasterize = vi.fn().mockResolvedValueOnce(fakeRaster()).mockResolvedValue(null);
    const registry = new SymbolIconRegistry({ rasterize, svgText: async () => '<svg/>' });
    const map = createFakeMap();
    await registry.ensure(map as never, sym(), DAY);
    registry.retheme(map as never, NIGHT);
    await settle();
    expect(registry.status('u1')).toBe('ready');
    expect(map.hasImage(symbolIconId('u1'))).toBe(true);
  });
});
