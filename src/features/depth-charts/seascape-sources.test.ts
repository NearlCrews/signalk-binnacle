import { chartSourceById } from 'signalk-chart-sources';
import { describe, expect, it } from 'vitest';
import { SEASCAPE_DEM_SOURCES, SEASCAPE_GROUP, SEASCAPE_VECTOR_SOURCES } from './seascape-sources';

function catalogDescriptor(id: string) {
  const source = chartSourceById(id);
  if (source?.upstream.mode !== 'xyz') throw new TypeError(`${id} is not an XYZ catalog source`);
  return {
    id: source.id,
    tiles: [source.upstream.urlTemplate],
    tileSize: source.tileSize,
    maxzoom: source.maxzoom,
    attribution: source.attribution,
  };
}

// Every field of these descriptors is an upstream fact the catalog owns and its scheduled monitor
// checks against the live TileJSON, so the assertions compare the whole object against the catalog
// instead of restating values here. Restating them is what made a correct upstream zoom-ceiling
// correction fail the build. toEqual rather than toMatchObject: the shape is narrow and fully
// owned, so a full compare also catches a sixth field hardcoded later. What stays pinned below is
// ours: the source count, the id, and the tile extension each overlay type requires.
describe('Seascape source descriptors', () => {
  it('maps the DEM source from the catalog, as webp terrarium tiles', () => {
    expect(SEASCAPE_DEM_SOURCES).toHaveLength(1);
    const [dem] = SEASCAPE_DEM_SOURCES;
    expect(dem).toEqual(catalogDescriptor('seascape-dem'));
    expect(dem.tiles[0]).toContain('{z}/{x}/{y}.webp');
  });

  it('maps the vector source from the catalog, as pbf tiles', () => {
    expect(SEASCAPE_VECTOR_SOURCES).toHaveLength(1);
    const [vector] = SEASCAPE_VECTOR_SOURCES;
    expect(vector).toEqual(catalogDescriptor('seascape-vector'));
    expect(vector.tiles[0]).toContain('{z}/{x}/{y}.pbf');
  });

  it('shares one group id and title across both sources', () => {
    expect(SEASCAPE_GROUP).toEqual({ id: 'seascape', title: 'Seascape bathymetry' });
  });
});
