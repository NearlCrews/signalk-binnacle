import { describe, expect, it } from 'vitest';
import { STREAMING_CHART_SOURCES } from '$features/depth-charts';
import { buildBathymetryOverlays } from './build-bathymetry-overlays';

describe('buildBathymetryOverlays', () => {
  it('registers Seascape DEM before, and Seascape vector after, every STREAMING_CHART_SOURCES id', () => {
    const ids = buildBathymetryOverlays({ companionBase: null }).map((overlay) => overlay.id);
    const streamingIds = new Set(STREAMING_CHART_SOURCES.map((source) => source.id));

    const demIndex = {
      depthShading: ids.indexOf('seascape-depth-shading'),
      hillshade: ids.indexOf('seascape-hillshade'),
    };
    const vectorIndex = {
      drying: ids.indexOf('seascape-drying'),
      contours: ids.indexOf('seascape-contours'),
    };
    const streamingIndexes = ids
      .map((id, index) => ({ id, index }))
      .filter(({ id }) => streamingIds.has(id))
      .map(({ index }) => index);

    expect(demIndex.depthShading).toBeGreaterThanOrEqual(0);
    expect(demIndex.hillshade).toBeGreaterThanOrEqual(0);
    expect(vectorIndex.drying).toBeGreaterThanOrEqual(0);
    expect(vectorIndex.contours).toBeGreaterThanOrEqual(0);
    expect(streamingIndexes.length).toBe(STREAMING_CHART_SOURCES.length);

    const lastDemIndex = Math.max(demIndex.depthShading, demIndex.hillshade);
    const firstStreamingIndex = Math.min(...streamingIndexes);
    const lastStreamingIndex = Math.max(...streamingIndexes);
    const firstVectorIndex = Math.min(vectorIndex.drying, vectorIndex.contours);

    expect(lastDemIndex).toBeLessThan(firstStreamingIndex);
    expect(lastStreamingIndex).toBeLessThan(firstVectorIndex);
  });
});
