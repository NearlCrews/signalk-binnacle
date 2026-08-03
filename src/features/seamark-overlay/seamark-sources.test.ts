import { describe, expect, it } from 'vitest';
import { expectCatalogFacts } from '$shared/testing';
import { createSeamarkOverlay, SEAMARK_SOURCES } from './seamark-sources';

describe('SEAMARK_SOURCES', () => {
  // This module used to hand-build the source, restating the title, tile template, zoom range, and
  // attribution that the catalog owns. Every value happened to still agree, but nothing would have
  // failed if OpenSeaMap had moved a host or extended its zoom range, which is exactly how the
  // stale NOAA bounds went unnoticed. Reading it means that cannot recur, and this pins it.
  it('takes every upstream fact from the catalog', () => {
    expect(SEAMARK_SOURCES).toHaveLength(1);
    expectCatalogFacts(SEAMARK_SOURCES[0], 'seamark');
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
  // under a chart raster is worse than no mark at all. Hidden-by-default and the rest of the band
  // wiring come from createSafetyOverlay, covered in raster-overlay.test.ts, so this pins the
  // binding only.
  it('binds the seamark source into the safety band', () => {
    const overlay = createSeamarkOverlay(SEAMARK_SOURCES[0]);
    expect(overlay.id).toBe('seamark');
    expect(overlay.band).toBe('safety');
  });
});
