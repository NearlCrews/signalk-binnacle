import { chartSourceById } from 'signalk-chart-sources';
import { describe, expect, it } from 'vitest';
import { createSeamarkOverlay, SEAMARK_SOURCES } from './seamark-sources';

describe('SEAMARK_SOURCES', () => {
  // This module used to hand-build the source, restating the title, tile template, zoom range, and
  // attribution that the catalog owns. Every value happened to still agree, but nothing would have
  // failed if OpenSeaMap had moved a host or extended its zoom range, which is exactly how the
  // stale NOAA bounds went unnoticed. Reading it means that cannot recur, and this pins it.
  it('takes every upstream fact from the catalog', () => {
    expect(SEAMARK_SOURCES).toHaveLength(1);
    const [seamark] = SEAMARK_SOURCES;
    const catalog = chartSourceById('seamark');
    if (catalog?.upstream.mode !== 'xyz') throw new TypeError('seamark is not an XYZ source');
    expect(seamark).toMatchObject({
      id: 'seamark',
      title: catalog.title,
      tiles: [catalog.upstream.urlTemplate],
      tileSize: catalog.tileSize,
      minzoom: catalog.minzoom,
      maxzoom: catalog.maxzoom,
      attribution: catalog.attribution,
    });
  });

  // MapLibre round-robins a tiles array by tile coordinate rather than failing over, so a second
  // host that went dark would blank half the tiles rather than degrade.
  it('lists exactly one tile host', () => {
    expect(SEAMARK_SOURCES[0].tiles).toHaveLength(1);
  });

  it('declares only the description, region, and category the catalog does not carry', () => {
    const [seamark] = SEAMARK_SOURCES;
    expect(seamark.region).toBe('Global');
    expect(seamark.category).toBe('reference');
    expect(seamark.description).toContain('OpenSeaMap');
  });
});

describe('createSeamarkOverlay', () => {
  // Seamarks are navigation aids, so they must draw above charts and routes: a hazard mark hidden
  // under a chart raster is worse than no mark at all.
  it('binds the source into the safety band, hidden until the user enables it', () => {
    const overlay = createSeamarkOverlay(SEAMARK_SOURCES[0]);
    expect(overlay.id).toBe('seamark');
    expect(overlay.band).toBe('safety');
    expect(overlay.defaultVisible).toBe(false);
  });
});
