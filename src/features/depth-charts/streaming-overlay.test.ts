import { chartSourceById } from 'signalk-chart-sources';
import { describe, expect, it } from 'vitest';
import { createStreamingChartOverlay } from './streaming-overlay';
import { STREAMING_CHART_SOURCES } from './streaming-sources';

describe('streaming chart sources', () => {
  it('every catalog source is well-formed with a substitutable tile token', () => {
    const ids = new Set<string>();
    for (const source of STREAMING_CHART_SOURCES) {
      expect(source.id).toBeTruthy();
      expect(source.title).toBeTruthy();
      expect(source.attribution).toBeTruthy();
      expect(source.tiles.length).toBeGreaterThan(0);
      for (const url of source.tiles) {
        expect(url.includes('{bbox-epsg-3857}') || url.includes('{z}')).toBe(true);
      }
      ids.add(source.id);
    }
    expect(ids.size).toBe(STREAMING_CHART_SOURCES.length);
  });

  it('splits the NOAA ENC data-quality category into its own overlay', () => {
    const tilesById = (id: string): string =>
      STREAMING_CHART_SOURCES.find((s) => s.id === id)?.tiles[0] ?? '';
    // The chart carries the chart categories only; data quality (8, 9) lives in its own overlay so
    // it toggles independently. The shallow-water and overscale warning categories (11, 12) are
    // deliberately not shipped, so no source requests them.
    expect(tilesById('depth-noaa-enc')).toContain('LAYERS=0,1,2,3,4,5,6,7,10&');
    expect(tilesById('depth-noaa-enc-quality')).toContain('LAYERS=8,9&');
    expect(STREAMING_CHART_SOURCES.some((s) => s.tiles[0].includes('LAYERS=11,12&'))).toBe(false);
  });

  it('uses shared NOAA ENC display metadata', () => {
    for (const id of ['depth-noaa-enc', 'depth-noaa-enc-quality']) {
      const rendered = STREAMING_CHART_SOURCES.find((source) => source.id === id);
      const catalog = chartSourceById(id);
      expect(rendered).toMatchObject({
        title: catalog?.title,
        tileSize: catalog?.tileSize,
        minzoom: catalog?.minzoom,
        maxzoom: catalog?.maxzoom,
        bounds: catalog?.bounds,
        attribution: catalog?.attribution,
        group: catalog?.group,
      });
    }
  });

  it('builds a hidden bathymetry overlay for each source', () => {
    for (const source of STREAMING_CHART_SOURCES) {
      const overlay = createStreamingChartOverlay(source);
      expect(overlay.id).toBe(source.id);
      expect(overlay.band).toBe('bathymetry');
      expect(overlay.defaultVisible).toBe(false);
      expect(overlay.supportsOpacity).toBe(true);
      expect(overlay.layerIds).toHaveLength(1);
    }
  });
});
