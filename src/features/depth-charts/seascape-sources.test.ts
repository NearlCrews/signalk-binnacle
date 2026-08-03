import { describe, expect, it } from 'vitest';
import { requireCatalogSource } from '$shared/map';
import { SEASCAPE_DEM_SOURCES, SEASCAPE_GROUP, SEASCAPE_VECTOR_SOURCES } from './seascape-sources';

// toEqual rather than toMatchObject: these shapes are narrow and fully owned, so a full compare
// also catches a field hardcoded later, and it holds the vector descriptor to the four fields its
// overlay actually reads rather than letting an unused tileSize ride along.
describe('Seascape source descriptors', () => {
  it('maps the DEM source from the catalog, as webp terrarium tiles', () => {
    expect(SEASCAPE_DEM_SOURCES).toHaveLength(1);
    const [dem] = SEASCAPE_DEM_SOURCES;
    const catalog = requireCatalogSource('seascape-dem', 'xyz');
    expect(dem).toEqual({
      id: 'seascape-dem',
      tiles: [catalog.upstream.urlTemplate],
      tileSize: catalog.tileSize,
      maxzoom: catalog.maxzoom,
      attribution: catalog.attribution,
    });
    expect(dem.tiles[0]).toContain('{z}/{x}/{y}.webp');
  });

  it('maps the vector source from the catalog, as pbf tiles, without a raster tile size', () => {
    expect(SEASCAPE_VECTOR_SOURCES).toHaveLength(1);
    const [vector] = SEASCAPE_VECTOR_SOURCES;
    const catalog = requireCatalogSource('seascape-vector', 'xyz');
    expect(vector).toEqual({
      id: 'seascape-vector',
      tiles: [catalog.upstream.urlTemplate],
      maxzoom: catalog.maxzoom,
      attribution: catalog.attribution,
    });
    expect(vector.tiles[0]).toContain('{z}/{x}/{y}.pbf');
  });

  it('shares one group id and title across both sources', () => {
    expect(SEASCAPE_GROUP).toEqual({ id: 'seascape', title: 'Seascape bathymetry' });
  });
});
