// The service worker's runtime caching table as pure data: src/sw.ts maps each entry to a serwist
// strategy instance, and the unit tests exercise the matchers without service worker machinery, so
// nothing here may import serwist or touch browser globals. The matchers are ordinary module
// functions bundled into the worker (the old generateSW Function.toString serialization, which
// forced every host list to be inlined, is gone).
//
// Layering: the worker caches byte-level GET assets (tiles, styles, WMS images) and only exists
// over trusted https; parsed application data (weather grids, tides, notes, PMTiles blocks) is
// cached in IndexedDB by app code, which also works over the plain-http boat LAN. The worker never
// touches /signalk/v1/api/ or /signalk/v2/api/ (auth-bearing, mutation-carrying), and every entry
// pins statuses to [200]: caching opaque (status 0) responses would burn quota at roughly 7 MB of
// padding per entry.

import { CHART_SOURCES, type ChartSource } from 'signalk-chart-sources';

const DAY_SECONDS = 60 * 60 * 24;
const THIRTY_SIX_HOURS_SECONDS = 36 * 60 * 60;
const TWO_HOURS_SECONDS = 60 * 60 * 2;
const HOUR_SECONDS = 60 * 60;

// The catalog is the single upstream authority for overlay hosts and time-dynamic families, and
// the matchers derive from it directly. Import the package itself, never the $shared/map barrel:
// this module is bundled into the service worker by a child build with no svelte plugin, and the
// barrel's graph reaches maplibre-gl.
const upstreamUrlOf = (source: ChartSource): string => {
  const upstream = source.upstream;
  switch (upstream.mode) {
    case 'style':
      return upstream.styleUrl;
    case 'wms':
    case 'arcgis':
      return upstream.base;
    default:
      return upstream.urlTemplate;
  }
};
const hostOf = (source: ChartSource): string => new URL(upstreamUrlOf(source)).hostname;

const STYLE_ORIGINS = new Set(
  CHART_SOURCES.filter((source) => source.upstream.mode === 'style').map(
    (source) => new URL(upstreamUrlOf(source)).origin,
  ),
);
const VOLATILE_SOURCES = CHART_SOURCES.filter((source) => source.maxAgeSeconds !== undefined);
const VOLATILE_HOSTS = new Set(VOLATILE_SOURCES.map(hostOf));
const VOLATILE_LAYER_FAMILIES = new Set(
  VOLATILE_SOURCES.flatMap((source) =>
    source.upstream.mode === 'wms' ? source.upstream.layers.split(',') : [],
  ).map((layer) => layer.split(':')[0]),
);
const OVERLAY_HOSTS = new Set([
  ...CHART_SOURCES.filter((source) => source.upstream.mode !== 'style').map(hostOf),
  // NASA GIBS is a feature-owned upstream (src/features/ocean-conditions/ocean-sources.ts), not a
  // catalog member; its tiles are date-stamped in the URL, so the 7 day cache holds them safely.
  'gibs.earthdata.nasa.gov',
]);

export interface MatchContext {
  url: URL;
  sameOrigin: boolean;
}

export interface RuntimeCacheRoute {
  urlPattern: (context: MatchContext) => boolean;
  handler: 'CacheFirst' | 'NetworkFirst' | 'StaleWhileRevalidate';
  options: {
    cacheName: string;
    networkTimeoutSeconds?: number;
    expiration: { maxEntries: number; maxAgeSeconds: number; purgeOnQuotaError?: boolean };
    cacheableResponse: { statuses: readonly number[] };
  };
}

export const isBasemapStyle = ({ url }: MatchContext): boolean =>
  STYLE_ORIGINS.has(url.origin) && url.pathname.startsWith('/styles/');

// A superset of isBasemapStyle (same origin, any path). Routing is first-match, so the style
// rule MUST stay listed before this one in runtimeCaching; reorder them and style documents fall
// through to CacheFirst here and pin a stale style whose tile references have aged out.
export const isBasemapAsset = ({ url }: MatchContext): boolean => STYLE_ORIGINS.has(url.origin);

// Raster chart tiles served by any Signal K charts plugin (@signalk/charts-plugin and kin) at
// /charts/<id>/{z}/{x}/{y}, tolerating @2x and an extension. Same-origin only.
export const isChartTile = ({ url, sameOrigin }: MatchContext): boolean =>
  sameOrigin && /^\/charts\/[^/]+\/\d+\/\d+\/\d+(?:@2x)?(?:\.\w+)?$/.test(url.pathname);

// The catalog's time-dynamic layer families (weather radar mosaics, watches and warnings, active
// tropical cyclones, and sea surface temperature). They share the nowcoast host with the static
// BlueTopo bathymetry pair, so the WMS LAYERS (or WMTS LAYER) value is what separates them; both
// the hosts and the families derive from the catalog's maxAgeSeconds sources above.
// Routing is first-match, so this rule MUST stay listed before isOverlayTile in runtimeCaching;
// reorder them and a radar frame is served CacheFirst as current for 7 days.
export const isVolatileOverlayTile = ({ url }: MatchContext): boolean => {
  if (!VOLATILE_HOSTS.has(url.hostname)) return false;
  for (const [name, value] of url.searchParams) {
    const param = name.toLowerCase();
    if (param !== 'layers' && param !== 'layer') continue;
    for (const layer of value.split(',')) {
      const family = layer.split(':')[0];
      if (family && VOLATILE_LAYER_FAMILIES.has(family)) return true;
    }
  }
  return false;
};

// The cross-origin overlay tile and WMS hosts Binnacle renders (NOAA ENC and MPA, GEBCO, the two
// EMODnet services, BlueTopo via nowcoast, Marine Regions boundaries, OpenSeaMap seamarks, and
// Seascape derive from the catalog above; NASA GIBS joins explicitly as a feature-owned host).
// One shared cache with a 7 day TTL bounds chart-edition staleness.
// The nowcoast time-dynamic layers are carved out by isVolatileOverlayTile, listed first.
export const isOverlayTile = ({ url }: MatchContext): boolean => OVERLAY_HOSTS.has(url.hostname);

export const isCoopsRequest = ({ url }: MatchContext): boolean =>
  url.hostname === 'api.tidesandcurrents.noaa.gov';

export const isRadarIndex = ({ url }: MatchContext): boolean =>
  (url.hostname === 'rainviewer.com' || url.hostname.endsWith('.rainviewer.com')) &&
  url.pathname.endsWith('.json');

export const isRadarTile = ({ url }: MatchContext): boolean =>
  (url.hostname === 'rainviewer.com' || url.hostname.endsWith('.rainviewer.com')) &&
  url.pathname.endsWith('.png');

// PMTiles archives are deliberately ABSENT: their range requests answer 206, which the Cache API
// refuses to store, so a worker route can never cache them. They are cached as aligned blocks in
// IndexedDB by the pmtiles protocol layer instead, which also covers plain-http contexts.
export const runtimeCaching: readonly RuntimeCacheRoute[] = [
  {
    // The base style document: serve the last one instantly, refresh behind. Revalidation on every
    // online use, not expiry, is what keeps a rotated OpenFreeMap planet build from pinning a stale
    // style, so the age cap matches the tile cache below: a style expiring sooner blanks the base
    // map on a long offline stretch while its tiles are still cached, and a stale style over
    // equally stale tiles renders fine.
    urlPattern: isBasemapStyle,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'binnacle-basemap-style',
      expiration: { maxEntries: 4, maxAgeSeconds: 30 * DAY_SECONDS },
      cacheableResponse: { statuses: [200] },
    },
  },
  {
    // The online vector base map (tiles, glyphs, sprite): cache what the navigator has viewed.
    urlPattern: isBasemapAsset,
    handler: 'CacheFirst',
    options: {
      cacheName: 'binnacle-basemap',
      expiration: {
        maxEntries: 4000,
        maxAgeSeconds: 30 * DAY_SECONDS,
        purgeOnQuotaError: true,
      },
      cacheableResponse: { statuses: [200] },
    },
  },
  {
    // Raster chart tiles from any Signal K charts plugin: viewed chart areas render offline.
    urlPattern: isChartTile,
    handler: 'CacheFirst',
    options: {
      cacheName: 'binnacle-chart-tiles',
      expiration: {
        maxEntries: 2000,
        maxAgeSeconds: 30 * DAY_SECONDS,
        purgeOnQuotaError: true,
      },
      cacheableResponse: { statuses: [200] },
    },
  },
  {
    // Time-dynamic nowcoast layers: a stored weather frame is wrong before anyone sails into it,
    // so prefer the network and keep at most an hour as the offline fallback. Must stay listed
    // before the isOverlayTile route below, which also matches the nowcoast host.
    urlPattern: isVolatileOverlayTile,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'binnacle-volatile-overlays',
      networkTimeoutSeconds: 8,
      expiration: { maxEntries: 200, maxAgeSeconds: HOUR_SECONDS, purgeOnQuotaError: true },
      cacheableResponse: { statuses: [200] },
    },
  },
  {
    urlPattern: isOverlayTile,
    handler: 'CacheFirst',
    options: {
      cacheName: 'binnacle-overlay-tiles',
      expiration: {
        maxEntries: 1500,
        maxAgeSeconds: 7 * DAY_SECONDS,
        purgeOnQuotaError: true,
      },
      cacheableResponse: { statuses: [200] },
    },
  },
  {
    // CO-OPS tide and current predictions: forecasts stay correct offline for the cached day.
    urlPattern: isCoopsRequest,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'binnacle-tides',
      networkTimeoutSeconds: 8,
      expiration: {
        maxEntries: 32,
        maxAgeSeconds: THIRTY_SIX_HOURS_SECONDS,
        purgeOnQuotaError: true,
      },
      cacheableResponse: { statuses: [200] },
    },
  },
  {
    // RainViewer radar frame index: prefer fresh frames, fall back to the last list offline.
    urlPattern: isRadarIndex,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'binnacle-radar-index',
      networkTimeoutSeconds: 6,
      expiration: { maxEntries: 4, maxAgeSeconds: TWO_HOURS_SECONDS, purgeOnQuotaError: true },
      cacheableResponse: { statuses: [200] },
    },
  },
  {
    // RainViewer radar tiles: each frame's tiles are immutable (the timestamp is in the path),
    // so cache them for offline and repeat use. The window is short because frames roll.
    urlPattern: isRadarTile,
    handler: 'CacheFirst',
    options: {
      cacheName: 'binnacle-radar-tiles',
      expiration: { maxEntries: 600, maxAgeSeconds: TWO_HOURS_SECONDS, purgeOnQuotaError: true },
      cacheableResponse: { statuses: [200] },
    },
  },
];
