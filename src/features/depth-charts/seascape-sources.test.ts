import { describe, expect, it } from 'vitest';
import { SEASCAPE_DEM_SOURCES, SEASCAPE_GROUP, SEASCAPE_VECTOR_SOURCES } from './seascape-sources';

describe('Seascape source descriptors', () => {
  it('declares one DEM source with an XYZ template, terrarium-appropriate maxzoom, and attribution', () => {
    expect(SEASCAPE_DEM_SOURCES).toHaveLength(1);
    const [dem] = SEASCAPE_DEM_SOURCES;
    expect(dem.id).toBe('seascape-dem');
    expect(dem.tiles[0]).toContain('{z}/{x}/{y}.webp');
    expect(dem.tileSize).toBe(512);
    expect(dem.maxzoom).toBe(17);
    expect(dem.attribution).toBeTruthy();
    expect(dem.attribution.length).toBeGreaterThan(40);
  });

  it('declares one vector source with an XYZ template, maxzoom 14, and attribution', () => {
    expect(SEASCAPE_VECTOR_SOURCES).toHaveLength(1);
    const [vector] = SEASCAPE_VECTOR_SOURCES;
    expect(vector.id).toBe('seascape-vector');
    expect(vector.tiles[0]).toContain('{z}/{x}/{y}.pbf');
    expect(vector.maxzoom).toBe(14);
    expect(vector.attribution).toBeTruthy();
  });

  it('shares one group id and title across both sources', () => {
    expect(SEASCAPE_GROUP).toEqual({ id: 'seascape', title: 'Seascape bathymetry' });
  });
});
