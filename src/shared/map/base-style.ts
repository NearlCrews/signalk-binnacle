import type { StyleSpecification } from 'maplibre-gl';
import { BASEMAP_SOURCE_ID, requireCatalogSource } from './catalog';
import { mapThemePaint } from './map-theme';

// The vector base map. MapLibre fetches this style JSON and its tiles, glyphs, and
// sprite. It is a free, keyless OpenStreetMap-derived vector style; the theme system
// recolors its background and water layers per theme via setPaintProperty. Signal K
// and NOAA charts layer on top. Offline operation comes from caching this source (a
// service-worker runtime cache plus an optional pre-downloaded PMTiles region), a
// later spec, not from removing it: a flat inline style yields a blank map.

// Not carried by the catalog, so it stays local. base-style.test.ts asserts it resolves to the same
// host as the style, which is what keeps this literal tied to the catalog's.
const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

// The style URL is the catalog's to own, but it cannot go through catalogSource: that helper builds
// a tile template, and a style document is not one. Hence the direct read, and it is lazy rather
// than module scope so a catalog-shape problem cannot take fallbackBaseStyle down with it. That
// fallback is the last-resort style that renders with no network at all and does not need this URL.
function vectorStyleUrl(): string {
  return requireCatalogSource(BASEMAP_SOURCE_ID, 'style').upstream.styleUrl;
}

export function baseStyleUrl(companionBase?: string | null): string {
  // Through Chart Locker the style, its glyphs, and its vector tiles are proxied and cached,
  // so the basemap geometry works offline. Without it, the direct openfreemap style is used.
  return companionBase ? `${companionBase}/style/basemap` : vectorStyleUrl();
}

// The last-resort base when the style JSON itself is unreachable (plain http at sea, where no
// service worker can cache it): one water-colored background so the map can finish its first
// render and fire 'load', which is what mounts every overlay, including the charts served from
// the IndexedDB block cache. This is a runtime fallback for a failed fetch, not a replacement
// for the vector base (see above). The glyphs URL must be declared even though it is unreachable
// here: adding any symbol layer with a text-field throws without one, while a failed glyph fetch
// just renders no text. The background color matches the day theme's water; the recolor pass
// themes it like any base background layer.
export function fallbackBaseStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'binnacle-offline-fallback',
    glyphs: GLYPHS_URL,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': mapThemePaint('day').water },
      },
    ],
  };
}
