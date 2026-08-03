import { chartSourceById } from 'signalk-chart-sources';
import { describe, expect, it } from 'vitest';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, declaredSource, type FakeMap, fakeOverlayContext } from '$shared/testing';
import { createSeascapeDemOverlay } from './seascape-dem-overlay';
import { SEASCAPE_DEM_SOURCES, type SeascapeDemSource } from './seascape-sources';

// Synthetic on purpose: this fixture exercises wiring, so a real catalog value here would read as
// an upstream fact and go stale whenever Seascape republishes its TileJSON.
const SOURCE: SeascapeDemSource = {
  id: 'seascape-dem',
  tiles: ['https://tiles.example.test/dem/{z}/{x}/{y}.webp'],
  tileSize: 512,
  maxzoom: 9,
  attribution: 'test attribution',
};

const ctx = (map: FakeMap) => fakeOverlayContext(map);

// setPaintProperty is a vi.fn(), so its .mock.calls is already properly typed; these two just
// name the two operations the applyTheme assertions below repeat.
function getMockCalls(map: FakeMap) {
  return map.setPaintProperty.mock.calls;
}

function clearMock(map: FakeMap): void {
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

  it("declares the source's zoom ceiling on the map, so a catalog correction reaches MapLibre", async () => {
    // seascape-sources.test.ts proves the module reads maxzoom from the catalog; this proves the
    // overlay then hands it on. Either link alone lets a corrected ceiling vanish silently.
    const map = createFakeMap();
    const { depthShading } = createSeascapeDemOverlay(SEASCAPE_DEM_SOURCES[0]);
    await depthShading.add(ctx(map));
    const expected = chartSourceById('seascape-dem')?.maxzoom;
    // Pinned so a missing catalog entry cannot make undefined match undefined and pass vacuously.
    expect(expected).toBeTypeOf('number');
    expect(declaredSource(map, 'seascape-dem').maxzoom).toBe(expected);
  });

  it('both rows share one raster-dem source, created once', async () => {
    const map = createFakeMap();
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    await depthShading.add(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(true);
    expect(map.layers.has('seascape-depth-shading-layer')).toBe(true);
    await hillshade.add(ctx(map));
    expect(map.layers.has('seascape-hillshade-layer')).toBe(true);
    // Hillshade's own add guard-adds the source too, but finds it already present from
    // depthShading.add, so it never creates a second one.
    expect(map.sources.size).toBe(1);
  });

  it('removing one row does not remove the shared source out from under the other', async () => {
    const map = createFakeMap();
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    await depthShading.add(ctx(map));
    await hillshade.add(ctx(map));
    depthShading.remove(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(true);
    expect(map.layers.has('seascape-hillshade-layer')).toBe(true);
    hillshade.remove(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(false);
  });

  it('removing rows in reverse order also preserves the shared source until both are gone', async () => {
    const map = createFakeMap();
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    await depthShading.add(ctx(map));
    await hillshade.add(ctx(map));
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

  it('depth shading applyTheme with different themes produces different color-relief-color expressions', async () => {
    const map = createFakeMap();
    const { depthShading } = createSeascapeDemOverlay(SOURCE);
    await depthShading.add(ctx(map));

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

  it('depth shading applyTheme with same theme reuses the memoized color-relief-color expression', async () => {
    const map = createFakeMap();
    const { depthShading } = createSeascapeDemOverlay(SOURCE);
    await depthShading.add(ctx(map));

    const dayPaint = mapThemePaint('day');

    depthShading.applyTheme?.(ctx(map), dayPaint);
    const firstColorExpr = getMockCalls(map)[0][2];

    clearMock(map);

    depthShading.applyTheme?.(ctx(map), dayPaint);
    const secondColorExpr = getMockCalls(map)[0][2];

    // Repeated calls with the same theme must use the exact same cached expression object
    expect(firstColorExpr).toBe(secondColorExpr);
  });

  it('hillshade applyTheme with different themes produces different shadow and highlight colors', async () => {
    const map = createFakeMap();
    const { hillshade } = createSeascapeDemOverlay(SOURCE);
    await hillshade.add(ctx(map));

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

  it('hillshade applyTheme with same theme reuses memoized shadow and highlight colors', async () => {
    const map = createFakeMap();
    const { hillshade } = createSeascapeDemOverlay(SOURCE);
    await hillshade.add(ctx(map));

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
