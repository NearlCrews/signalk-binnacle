import { describe, expect, it } from 'vitest';
import { FALLBACK_WATER_LAYER_ID } from './base-style';
import {
  applyBaseIconVisibility,
  applyBaseRasterVisibility,
  applyBaseTheme,
  baseLayerPaint,
} from './base-theme';
import { mapThemePaint } from './map-theme';

const paint = mapThemePaint('night-red');

// A minimal MapLibre-shaped stub that stores paint and layout values. MapLibre treats fill-pattern
// as a PAINT property and throws if it is reached through the layout API, so the stub does too.
function fakeStyleMap(layers: Array<Record<string, unknown>>) {
  const paintStore = new Map<string, unknown>();
  const layoutStore = new Map<string, unknown>();
  const guardLayout = (prop: string) => {
    if (prop === 'fill-pattern')
      throw new Error('fill-pattern is a PAINT property not a LAYOUT property.');
  };
  return {
    getStyle: () => ({ layers }),
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    getPaintProperty: (id: string, prop: string) => paintStore.get(`${id}|${prop}`),
    setPaintProperty: (id: string, prop: string, value: unknown) =>
      paintStore.set(`${id}|${prop}`, value),
    getLayoutProperty: (id: string, prop: string) => {
      guardLayout(prop);
      return layoutStore.get(`${id}|${prop}`);
    },
    setLayoutProperty: (id: string, prop: string, value: unknown) => {
      guardLayout(prop);
      layoutStore.set(`${id}|${prop}`, value);
    },
  };
}

describe('baseLayerPaint', () => {
  it('recolors the background', () => {
    expect(baseLayerPaint({ id: 'background', type: 'background' }, paint)).toEqual({
      property: 'background-color',
      color: paint.background,
    });
  });

  it('recolors fills, lines, and extrusions by source layer', () => {
    expect(baseLayerPaint({ id: 'water', type: 'fill', 'source-layer': 'water' }, paint)).toEqual({
      property: 'fill-color',
      color: paint.water,
    });
    expect(
      baseLayerPaint(
        { id: 'road_motorway', type: 'line', 'source-layer': 'transportation' },
        paint,
      ),
    ).toEqual({ property: 'line-color', color: paint.road });
    expect(baseLayerPaint({ id: 'park', type: 'fill', 'source-layer': 'park' }, paint)).toEqual({
      property: 'fill-color',
      color: paint.landcover,
    });
    expect(
      baseLayerPaint({ id: 'landuse_residential', type: 'fill', 'source-layer': 'landuse' }, paint),
    ).toEqual({ property: 'fill-color', color: paint.land });
    expect(
      baseLayerPaint({ id: 'boundary_2', type: 'line', 'source-layer': 'boundary' }, paint),
    ).toEqual({ property: 'line-color', color: paint.boundary });
    expect(
      baseLayerPaint(
        { id: 'building-3d', type: 'fill-extrusion', 'source-layer': 'building' },
        paint,
      ),
    ).toEqual({ property: 'fill-extrusion-color', color: paint.land });
  });

  it('splits aeroway into apron land and runway road by geometry type', () => {
    expect(
      baseLayerPaint({ id: 'aeroway_fill', type: 'fill', 'source-layer': 'aeroway' }, paint),
    ).toEqual({ property: 'fill-color', color: paint.land });
    expect(
      baseLayerPaint({ id: 'aeroway_runway', type: 'line', 'source-layer': 'aeroway' }, paint),
    ).toEqual({ property: 'line-color', color: paint.road });
  });

  it('recolors every symbol text to the label color', () => {
    expect(
      baseLayerPaint({ id: 'label_city', type: 'symbol', 'source-layer': 'place' }, paint),
    ).toEqual({ property: 'text-color', color: paint.label });
  });

  it('paints the offline fallback layer as water in every theme', () => {
    for (const theme of ['day', 'dusk', 'night-red'] as const) {
      const themed = mapThemePaint(theme);
      expect(baseLayerPaint({ id: FALLBACK_WATER_LAYER_ID, type: 'background' }, themed)).toEqual({
        property: 'background-color',
        color: themed.water,
      });
    }
  });

  it('leaves rasters and unknown source layers untouched', () => {
    expect(baseLayerPaint({ id: 'natural_earth', type: 'raster' }, paint)).toBeNull();
    expect(
      baseLayerPaint({ id: 'mystery', type: 'fill', 'source-layer': 'who_knows' }, paint),
    ).toBeNull();
  });
});

describe('applyBaseTheme', () => {
  const night = mapThemePaint('night-red');

  it('recolors by source layer, clears fill patterns, and halos every label', () => {
    const map = fakeStyleMap([
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', 'source-layer': 'water' },
      { id: 'road_label', type: 'symbol', 'source-layer': 'transportation_name' },
      { id: 'mystery', type: 'fill', 'source-layer': 'who_knows' },
    ]);
    map.setPaintProperty('water', 'fill-pattern', 'wetland');
    map.setPaintProperty('mystery', 'fill-color', 'rgb(1,2,3)');

    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    applyBaseTheme(map as any, night);
    expect(map.getPaintProperty('background', 'background-color')).toBe(night.background);
    expect(map.getPaintProperty('water', 'fill-color')).toBe(night.water);
    expect(map.getPaintProperty('water', 'fill-pattern')).toBeUndefined();
    // The theme gives every label a background-colored halo, even one with none of its own.
    expect(map.getPaintProperty('road_label', 'text-halo-color')).toBe(night.background);
    expect(map.getPaintProperty('mystery', 'fill-color')).toBe('rgb(1,2,3)');
  });
});

describe('applyBaseIconVisibility', () => {
  it('hides every base sprite icon at night-red and shows them otherwise', () => {
    const map = fakeStyleMap([
      { id: 'poi_r1', type: 'symbol', 'source-layer': 'poi', layout: { 'icon-image': 'dot' } },
      // A road shield carries a sprite icon too, so it is hidden at night-red along with the POI dots.
      {
        id: 'road_shield',
        type: 'symbol',
        'source-layer': 'transportation',
        layout: { 'icon-image': 'shield' },
      },
      // A place label is a symbol with no icon, so its (text-only) layer is left alone.
      { id: 'label_city', type: 'symbol', 'source-layer': 'place', layout: {} },
      // An overlay-owned symbol layer (own vessel, AIS, notes) themes itself and carries the
      // user's saved opacity, so the base icon pass must leave it untouched in both directions.
      {
        id: 'binnacle-ais-symbol',
        type: 'symbol',
        layout: { 'icon-image': 'binnacle-ais-icon' },
      },
    ]);

    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    applyBaseIconVisibility(map as any, mapThemePaint('night-red'));
    expect(map.getPaintProperty('poi_r1', 'icon-opacity')).toBe(0);
    expect(map.getPaintProperty('road_shield', 'icon-opacity')).toBe(0);
    expect(map.getPaintProperty('label_city', 'icon-opacity')).toBeUndefined();
    expect(map.getPaintProperty('binnacle-ais-symbol', 'icon-opacity')).toBeUndefined();

    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    applyBaseIconVisibility(map as any, mapThemePaint('day'));
    expect(map.getPaintProperty('poi_r1', 'icon-opacity')).toBe(1);
    expect(map.getPaintProperty('road_shield', 'icon-opacity')).toBe(1);
    expect(map.getPaintProperty('binnacle-ais-symbol', 'icon-opacity')).toBeUndefined();
    // Dusk fades the pre-colored sprite icons instead of hiding them: a pure-white highway
    // shield is otherwise the brightest element on the dark dusk chart.
    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    applyBaseIconVisibility(map as any, mapThemePaint('dusk'));
    expect(map.getPaintProperty('poi_r1', 'icon-opacity')).toBe(0.4);
  });
});

describe('applyBaseRasterVisibility', () => {
  it('applies each theme relief treatment to base rasters and leaves overlay rasters alone', () => {
    const map = fakeStyleMap([
      { id: 'natural_earth', type: 'raster' },
      { id: 'binnacle-depth', type: 'raster' },
      { id: 'water', type: 'fill', 'source-layer': 'water' },
    ]);
    const relief = () => [
      map.getPaintProperty('natural_earth', 'raster-opacity'),
      map.getPaintProperty('natural_earth', 'raster-saturation'),
    ];

    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    applyBaseRasterVisibility(map as any, mapThemePaint('day'));
    expect(relief()).toEqual([0.35, -1]);
    expect(map.getPaintProperty('binnacle-depth', 'raster-opacity')).toBeUndefined();
    expect(map.getPaintProperty('water', 'raster-opacity')).toBeUndefined();

    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    applyBaseRasterVisibility(map as any, mapThemePaint('night-red'));
    expect(relief()[0]).toBe(0);

    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    applyBaseRasterVisibility(map as any, mapThemePaint('dusk'));
    expect(relief()).toEqual([1, 0]);
  });
});
