import { describe, expect, it, vi } from 'vitest';
import { mapThemePaint } from '$shared/map';
import { createSeascapeDemOverlay } from './seascape-dem-overlay';
import type { SeascapeDemSource } from './seascape-sources';

const SOURCE: SeascapeDemSource = {
  id: 'seascape-dem',
  tiles: ['https://tiles.openwaters.io/seascape/{z}/{x}/{y}.webp'],
  tileSize: 512,
  maxzoom: 17,
  attribution: 'test attribution',
};

// A minimal fake of the MapLibre map surface the two overlays touch, enough to prove the
// shared-source contract without a real MapLibre instance.
function fakeMap() {
  const sources = new Set<string>();
  const layers = new Map<string, { type: string }>();
  const setPaintProperty = vi.fn();
  return {
    sources,
    layers,
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    addSource: (id: string) => sources.add(id),
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string; type: string }) => layers.set(layer.id, layer),
    removeLayer: (id: string) => layers.delete(id),
    setPaintProperty,
  };
}

const ctx = (map: ReturnType<typeof fakeMap>) => ({
  map: map as never,
  beforeIdFor: () => undefined,
});

// setPaintProperty is a vi.fn(), so its .mock.calls is already properly typed; these two just
// name the two operations the applyTheme assertions below repeat.
function getMockCalls(map: ReturnType<typeof fakeMap>) {
  return map.setPaintProperty.mock.calls;
}

function clearMock(map: ReturnType<typeof fakeMap>): void {
  map.setPaintProperty.mockClear();
}

describe('createSeascapeDemOverlay', () => {
  it('declares both rows in the bathymetry band, hidden by default, grouped together', () => {
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    expect(depthShading.id).toBe('seascape-depth-shading');
    expect(depthShading.band).toBe('bathymetry');
    expect(depthShading.defaultVisible).toBe(false);
    expect(depthShading.group).toEqual({ id: 'seascape', title: 'Seascape bathymetry' });
    expect(hillshade.id).toBe('seascape-hillshade');
    expect(hillshade.parent).toBe('seascape-depth-shading');
    expect(hillshade.group).toEqual({ id: 'seascape', title: 'Seascape bathymetry' });
  });

  it('both rows share one raster-dem source, created once', () => {
    const map = fakeMap();
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    depthShading.add(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(true);
    expect(map.layers.has('seascape-depth-shading-layer')).toBe(true);
    hillshade.add(ctx(map));
    expect(map.layers.has('seascape-hillshade-layer')).toBe(true);
    // Hillshade's own add guard-adds the source too, but finds it already present from
    // depthShading.add, so it never creates a second one.
    expect(map.sources.size).toBe(1);
  });

  it('removing one row does not remove the shared source out from under the other', () => {
    const map = fakeMap();
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    depthShading.add(ctx(map));
    hillshade.add(ctx(map));
    depthShading.remove(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(true);
    expect(map.layers.has('seascape-hillshade-layer')).toBe(true);
    hillshade.remove(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(false);
  });

  it('removing rows in reverse order also preserves the shared source until both are gone', () => {
    const map = fakeMap();
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    depthShading.add(ctx(map));
    hillshade.add(ctx(map));
    hillshade.remove(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(true);
    expect(map.layers.has('seascape-depth-shading-layer')).toBe(true);
    depthShading.remove(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(false);
  });

  it('depth shading supports opacity; hillshade does not (no MapLibre hillshade opacity paint property)', () => {
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    expect(depthShading.supportsOpacity).toBe(true);
    expect(hillshade.supportsOpacity).toBe(false);
  });

  it('depth shading applyTheme with different themes produces different color-relief-color expressions', () => {
    const map = fakeMap();
    const { depthShading } = createSeascapeDemOverlay(SOURCE);
    depthShading.add(ctx(map));

    const dayPaint = mapThemePaint('day');
    depthShading.applyTheme?.(ctx(map), dayPaint);
    const dayColorExpr = getMockCalls(map)[0][2];

    clearMock(map);

    const duskPaint = mapThemePaint('dusk');
    depthShading.applyTheme?.(ctx(map), duskPaint);
    const duskColorExpr = getMockCalls(map)[0][2];

    // Different themes must produce different color expressions
    expect(dayColorExpr).not.toEqual(duskColorExpr);
  });

  it('depth shading applyTheme with same theme reuses the memoized color-relief-color expression', () => {
    const map = fakeMap();
    const { depthShading } = createSeascapeDemOverlay(SOURCE);
    depthShading.add(ctx(map));

    const dayPaint = mapThemePaint('day');

    depthShading.applyTheme?.(ctx(map), dayPaint);
    const firstColorExpr = getMockCalls(map)[0][2];

    clearMock(map);

    depthShading.applyTheme?.(ctx(map), dayPaint);
    const secondColorExpr = getMockCalls(map)[0][2];

    // Repeated calls with the same theme must use the exact same cached expression object
    expect(firstColorExpr).toBe(secondColorExpr);
  });

  it('hillshade applyTheme with different themes produces different shadow and highlight colors', () => {
    const map = fakeMap();
    const { hillshade } = createSeascapeDemOverlay(SOURCE);
    hillshade.add(ctx(map));

    const dayPaint = mapThemePaint('day');
    hillshade.applyTheme?.(ctx(map), dayPaint);
    const dayShadowColor = getMockCalls(map).find(
      (call) => call[1] === 'hillshade-shadow-color',
    )?.[2];
    const dayHighlightColor = getMockCalls(map).find(
      (call) => call[1] === 'hillshade-highlight-color',
    )?.[2];

    clearMock(map);

    const nightPaint = mapThemePaint('night-red');
    hillshade.applyTheme?.(ctx(map), nightPaint);
    const nightShadowColor = getMockCalls(map).find(
      (call) => call[1] === 'hillshade-shadow-color',
    )?.[2];
    const nightHighlightColor = getMockCalls(map).find(
      (call) => call[1] === 'hillshade-highlight-color',
    )?.[2];

    // Different themes must produce different colors
    expect(dayShadowColor).not.toEqual(nightShadowColor);
    expect(dayHighlightColor).not.toEqual(nightHighlightColor);
  });

  it('hillshade applyTheme with same theme reuses memoized shadow and highlight colors', () => {
    const map = fakeMap();
    const { hillshade } = createSeascapeDemOverlay(SOURCE);
    hillshade.add(ctx(map));

    const dayPaint = mapThemePaint('day');

    hillshade.applyTheme?.(ctx(map), dayPaint);
    const firstShadowColor = getMockCalls(map).find(
      (call) => call[1] === 'hillshade-shadow-color',
    )?.[2];
    const firstHighlightColor = getMockCalls(map).find(
      (call) => call[1] === 'hillshade-highlight-color',
    )?.[2];

    clearMock(map);

    hillshade.applyTheme?.(ctx(map), dayPaint);
    const secondShadowColor = getMockCalls(map).find(
      (call) => call[1] === 'hillshade-shadow-color',
    )?.[2];
    const secondHighlightColor = getMockCalls(map).find(
      (call) => call[1] === 'hillshade-highlight-color',
    )?.[2];

    // Repeated calls with the same theme must use the exact same cached color strings
    expect(firstShadowColor).toBe(secondShadowColor);
    expect(firstHighlightColor).toBe(secondHighlightColor);
  });
});
