import { expect } from 'vitest';
import { requireCatalogSource } from '$shared/map';

/** The subset of a rendered raster overlay source that the catalog, not the slice, owns. */
interface CatalogBackedSource {
  id: string;
  title?: string;
  tiles: string[];
  tileSize?: number;
  minzoom?: number;
  maxzoom?: number;
  bounds?: readonly number[];
  attribution?: string;
  group?: unknown;
}

/**
 * Asserts that every upstream fact on a rendered source still matches the catalog entry it claims.
 *
 * Each slice used to spell its own version of this, and they disagreed on coverage: one checked
 * bounds and group, another checked the tile template and zoom floor, so a stale bounds could slip
 * through the newer shape. Stale bounds is the exact failure that dropped Guam, the Northern
 * Marianas, and the Pacific Remote Islands off the protected-area overlay, so the check is spelled
 * once here and every slice gets the whole set.
 */
export function expectCatalogFacts(rendered: CatalogBackedSource | undefined, id: string): void {
  expect(rendered, `no rendered source for ${id}`).toBeDefined();
  const catalog = requireCatalogSource(id);
  expect(rendered).toMatchObject({
    id: catalog.id,
    title: catalog.title,
    tileSize: catalog.tileSize,
    minzoom: catalog.minzoom,
    maxzoom: catalog.maxzoom,
    attribution: catalog.attribution,
  });
  expect(rendered?.bounds, `${id} bounds drifted from the catalog`).toEqual(catalog.bounds);
  expect(rendered?.group, `${id} group drifted from the catalog`).toEqual(catalog.group);
  // A tiles array with a second host is not an upstream fact but a rendering hazard: MapLibre
  // round-robins by tile coordinate rather than failing over, so a host that went dark would blank
  // half the tiles instead of degrading.
  expect(rendered?.tiles).toHaveLength(1);
}
