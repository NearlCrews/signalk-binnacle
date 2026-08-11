import { describe, expect, it } from 'vitest';
import {
  applyBaseIconVisibility,
  applyBaseTheme,
  baseLayerPaint,
  captureBaseTheme,
  restoreBaseTheme,
} from './base-theme';
import { mapThemePaint } from './map-theme';

const paint = mapThemePaint('night-red');

// A minimal MapLibre-shaped stub: it stores paint and layout values so capture and restore can
// round-trip them. Crucially, MapLibre treats fill-pattern as a PAINT property and throws if you
// reach it through the layout API, so the stub does too. That faithfulness is what makes these
// tests catch the layout-vs-paint mistake that once dropped every fill from the snapshot.
function fakeStyleMap(layers: Array<Record<string, unknown>>) {
  const paintStore = new Map<string, unknown>();
  const layoutStore = new Map<string, unknown>();
  const guardLayout = (prop: string) => {
    if (prop === 'fill-pattern')
      throw new Error('fill-pattern is a PAINT property not a LAYOUT property.');
  };
  return {
    getStyle: () => ({ layers }),
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

  it('leaves rasters and unknown source layers untouched', () => {
    expect(baseLayerPaint({ id: 'natural_earth', type: 'raster' }, paint)).toBeNull();
    expect(
      baseLayerPaint({ id: 'mystery', type: 'fill', 'source-layer': 'who_knows' }, paint),
    ).toBeNull();
  });
});

describe('captureBaseTheme and restoreBaseTheme', () => {
  const night = mapThemePaint('night-red');

  it('restores the source colors after a recolor (day shows the real map)', () => {
    const layers = [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', 'source-layer': 'water' },
      // A label that defines its own halo, and one that relies on the style default (no halo).
      { id: 'label_city', type: 'symbol', 'source-layer': 'place' },
      { id: 'road_label', type: 'symbol', 'source-layer': 'transportation_name' },
      { id: 'mystery', type: 'fill', 'source-layer': 'who_knows' },
    ];
    const map = fakeStyleMap(layers);
    // Seed the source-style values. fill-pattern is a paint property, like MapLibre treats it.
    map.setPaintProperty('background', 'background-color', '#f8f4f0');
    map.setPaintProperty('water', 'fill-color', 'rgb(158,189,255)');
    map.setPaintProperty('water', 'fill-pattern', 'wetland');
    map.setPaintProperty('label_city', 'text-color', '#333333');
    map.setPaintProperty('label_city', 'text-halo-color', '#ffffff');
    map.setPaintProperty('road_label', 'text-color', '#666');

    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    const snapshot = captureBaseTheme(map as any, mapThemePaint('day'));
    // Every base layer the recolor touches must be captured, fills included (the layout-vs-paint
    // bug once dropped all of them, leaving water and land stuck dark after switching to day).
    expect(snapshot.map((e) => e.id).sort()).toEqual([
      'background',
      'label_city',
      'road_label',
      'water',
    ]);

    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    applyBaseTheme(map as any, night);
    expect(map.getPaintProperty('background', 'background-color')).toBe(night.background);
    expect(map.getPaintProperty('water', 'fill-pattern')).toBeUndefined();
    // The theme gives every label a background-colored halo, even the one with none of its own.
    expect(map.getPaintProperty('road_label', 'text-halo-color')).toBe(night.background);

    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    restoreBaseTheme(map as any, snapshot);
    expect(map.getPaintProperty('background', 'background-color')).toBe('#f8f4f0');
    expect(map.getPaintProperty('water', 'fill-color')).toBe('rgb(158,189,255)');
    expect(map.getPaintProperty('water', 'fill-pattern')).toBe('wetland');
    expect(map.getPaintProperty('label_city', 'text-halo-color')).toBe('#ffffff');
    // The label with no source halo must lose the theme's added halo, not keep it dark.
    expect(map.getPaintProperty('road_label', 'text-halo-color')).toBeUndefined();
  });

  it('keeps an entry even when an optional getter throws', () => {
    const map = fakeStyleMap([{ id: 'water', type: 'fill', 'source-layer': 'water' }]);
    map.setPaintProperty('water', 'fill-color', 'rgb(1,2,3)');
    // Simulate a map where reading the optional fill-pattern throws; the color must still capture.
    map.getPaintProperty = (id: string, prop: string) => {
      if (prop === 'fill-pattern') throw new Error('boom');
      return id === 'water' && prop === 'fill-color' ? 'rgb(1,2,3)' : undefined;
    };
    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for the test
    const snapshot = captureBaseTheme(map as any, mapThemePaint('day'));
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ id: 'water', property: 'fill-color', color: 'rgb(1,2,3)' });
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
