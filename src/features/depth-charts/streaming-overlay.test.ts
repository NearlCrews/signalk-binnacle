import { describe, expect, it } from 'vitest';
import { requireCatalogSource } from '$shared/map';
import { expectCatalogFacts } from '$shared/testing';
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
      expectCatalogFacts(
        STREAMING_CHART_SOURCES.find((source) => source.id === id),
        id,
      );
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

  it('marks exactly the NOAA ENC chart as a navigation chart for the ambient badge', () => {
    // Exhaustive over the family list, so a new sibling can neither silently gain the flag nor
    // silently strip it from the ENC.
    const flagged = STREAMING_CHART_SOURCES.filter((source) => source.chartCoverage !== undefined);
    expect(flagged.map((source) => source.id)).toEqual(['depth-noaa-enc']);
    const overlays = STREAMING_CHART_SOURCES.map((source) => createStreamingChartOverlay(source));
    expect(
      overlays.filter((overlay) => overlay.chartCoverage !== undefined).map((o) => o.id),
    ).toEqual(['depth-noaa-enc']);
  });

  it('takes the ENC badge coverage from the catalog regional coverage, never the envelope', () => {
    const catalog = requireCatalogSource('depth-noaa-enc');
    const enc = STREAMING_CHART_SOURCES.find((source) => source.id === 'depth-noaa-enc');
    // The catalog must carry a real regional coverage list: the WMS bounds are the near-worldwide
    // service envelope, and using them would call the whole planet charted.
    expect(catalog.coverage).toBeDefined();
    expect(catalog.coverage?.length).toBeGreaterThan(1);
    expect(enc?.chartCoverage).toEqual({
      coverage: catalog.coverage,
      minzoom: catalog.minzoom,
      maxzoom: catalog.maxzoom,
    });
  });
});
