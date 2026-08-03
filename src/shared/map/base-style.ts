import type { StyleSpecification } from 'maplibre-gl';
import { chartSourceById } from 'signalk-chart-sources';
import { mapThemePaint } from './map-theme';

// The vector base map. MapLibre fetches this style JSON and its tiles, glyphs, and
// sprite. It is a free, keyless OpenStreetMap-derived vector style; the theme system
// recolors its background and water layers per theme via setPaintProperty. Signal K
// and NOAA charts layer on top. Offline operation comes from caching this source (a
// service-worker runtime cache plus an optional pre-downloaded PMTiles region), a
// later spec, not from removing it: a flat inline style yields a blank map.
//
// The style URL is an upstream fact the catalog owns, so it is read rather than restated. This one
// cannot go through catalogSource: that helper builds a tile template, and catalogTiles rejects a
// style-mode source because a style document is not a tile template. Hence the direct guarded read.
// The glyphs URL below is not carried by the catalog, so it stays local; base-style.test.ts asserts
// it resolves to the same host, which makes that test the cross-check between the two.
const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

// Read lazily, not at module scope, so a catalog-shape problem cannot take fallbackBaseStyle down
// with it. That fallback is the last-resort style that lets the map render with no network at all,
// and it does not need this URL; a module-scope throw would turn a bad catalog into no map.
// Throwing here is right: the catalog is a frozen constant of a pinned dependency, so this is
// unreachable without a dependency bump, and the gate exercises the real path on every run. Falling
// back to a hardcoded literal would reinstate exactly the duplication this read removes.
function vectorStyleUrl(): string {
  const basemap = chartSourceById('basemap');
  if (basemap?.upstream.mode !== 'style') {
    throw new TypeError('Missing style chart source metadata for basemap');
  }
  return basemap.upstream.styleUrl;
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
