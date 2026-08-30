import { describe, expect, it, vi } from 'vitest';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext, sourceFeatures } from '$shared/testing';
import type { RegionZone } from './region-zones-client';
import { createRegionZonesOverlay, REGION_ZONES_HIT_LAYER } from './region-zones-overlay';
import type { RegionZonesLoadState, RegionZonesStore } from './region-zones-store.svelte';

function zone(id: string, severity: RegionZone['severity']): RegionZone {
  return {
    id,
    name: `Zone ${id}`,
    description: 'A synthetic test area',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    },
    labelPosition: [0.5, 0.5],
    severity,
  };
}

function fakeStore(
  regions: RegionZone[] = [],
  state: RegionZonesLoadState = 'ready',
): RegionZonesStore {
  return {
    state,
    regions,
    ensureLoaded: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  };
}

describe('region zones overlay', () => {
  it('adds the fill, outline, and label layers and syncs zone features', async () => {
    const store = fakeStore([zone('a', 'warning'), zone('b', 'neutral')]);
    const overlay = createRegionZonesOverlay(store);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    expect(overlay.band).toBe('safety');
    expect(overlay.category).toBe('reference');
    expect(overlay.defaultVisible).toBe(false);
    expect(map.getLayer('binnacle-region-zones-fill')).toBeTruthy();
    expect(map.getLayer('binnacle-region-zones-outline')).toBeTruthy();
    expect(map.getLayer('binnacle-region-zones-label')).toBeTruthy();
    expect(REGION_ZONES_HIT_LAYER).toBe('binnacle-region-zones-fill');
    const shapes = sourceFeatures(map, 'binnacle-region-zones-shapes');
    expect(shapes).toHaveLength(2);
    expect(shapes[0].properties).toMatchObject({
      id: 'a',
      name: 'Zone a',
      description: 'A synthetic test area',
      severity: 'warning',
    });
    const labels = sourceFeatures(map, 'binnacle-region-zones-labels');
    expect(labels).toHaveLength(2);
    expect(labels[0].geometry).toEqual({ type: 'Point', coordinates: [0.5, 0.5] });
  });

  it('sync is a no-op while the store regions are unchanged', async () => {
    const store = fakeStore([zone('a', 'neutral')]);
    const overlay = createRegionZonesOverlay(store);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    map.sources.get('binnacle-region-zones-shapes')?.setData?.('marker');
    overlay.sync(fakeOverlayContext(map));
    expect(map.sources.get('binnacle-region-zones-shapes')?.data).toBe('marker');
  });

  it('reset forces the next sync to repopulate', async () => {
    const store = fakeStore([zone('a', 'neutral')]);
    const overlay = createRegionZonesOverlay(store);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    map.sources.get('binnacle-region-zones-shapes')?.setData?.('marker');
    overlay.reset?.();
    overlay.sync(fakeOverlayContext(map));
    expect(sourceFeatures(map, 'binnacle-region-zones-shapes')).toHaveLength(1);
  });

  it('turning visible asks the store to load, turning hidden does not', async () => {
    const store = fakeStore();
    const overlay = createRegionZonesOverlay(store);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), false);
    expect(store.ensureLoaded).not.toHaveBeenCalled();
    overlay.setVisible(fakeOverlayContext(map), true);
    expect(store.ensureLoaded).toHaveBeenCalledTimes(1);
  });

  it('applyTheme recolors the fill, outline, and label', async () => {
    const overlay = createRegionZonesOverlay(fakeStore());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red'));
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-region-zones-label',
      'text-halo-color',
      mapThemePaint('night-red').background,
    );
  });

  it('setOpacity scales the faint fill with the outline and label', async () => {
    const overlay = createRegionZonesOverlay(fakeStore());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setOpacity?.(fakeOverlayContext(map), 0.5);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-region-zones-fill',
      'fill-opacity',
      0.06,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-region-zones-outline',
      'line-opacity',
      0.5,
    );
  });

  it('remove clears every layer and source', async () => {
    const overlay = createRegionZonesOverlay(fakeStore([zone('a', 'neutral')]));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.getLayer('binnacle-region-zones-fill')).toBeUndefined();
    expect(map.getSource('binnacle-region-zones-shapes')).toBeUndefined();
    expect(map.getSource('binnacle-region-zones-labels')).toBeUndefined();
  });

  it('reads unavailable from the store for the grayed panel row', () => {
    expect(createRegionZonesOverlay(fakeStore([], 'unavailable')).available?.()).toBe(false);
    expect(createRegionZonesOverlay(fakeStore([], 'idle')).available?.()).toBe(true);
  });
});
