// The service worker's runtime caching table, extracted from vite.config.ts so the matchers are
// unit-testable pure functions. The build serializes each urlPattern via Function.toString into the
// generated worker WITHOUT its module scope, so every matcher must be SELF-CONTAINED: inline its
// regexes and host lists, and never reference a module-level const or helper (it would be undefined
// in the worker and throw ReferenceError on the first matched fetch, breaking all caching). Nothing
// here may touch browser globals either.
//
// Layering: the worker caches byte-level GET assets (tiles, styles, WMS images) and only exists
// over trusted https; parsed application data (weather grids, tides, notes, PMTiles blocks) is
// cached in IndexedDB by app code, which also works over the plain-http boat LAN. The worker never
// touches /signalk/v1/api/ or /signalk/v2/api/ (auth-bearing, mutation-carrying), and every entry
// pins statuses to [200]: caching opaque (status 0) responses would burn quota at roughly 7 MB of
// padding per entry.

const DAY_SECONDS = 60 * 60 * 24;
const THIRTY_SIX_HOURS_SECONDS = 36 * 60 * 60;
const TWO_HOURS_SECONDS = 60 * 60 * 2;
const HOUR_SECONDS = 60 * 60;

interface MatchContext {
  url: URL;
  sameOrigin: boolean;
}

export const isBasemapStyle = ({ url }: MatchContext): boolean =>
  url.origin === 'https://tiles.openfreemap.org' && url.pathname.startsWith('/styles/');

// A superset of isBasemapStyle (same origin, any path). Workbox routes first-match, so the style
// rule MUST stay listed before this one in runtimeCaching; reorder them and style documents fall
// through to CacheFirst here and pin a stale style whose tile references have aged out.
export const isBasemapAsset = ({ url }: MatchContext): boolean =>
  url.origin === 'https://tiles.openfreemap.org';

// Raster chart tiles served by any Signal K charts plugin (@signalk/charts-plugin and kin) at
// /charts/<id>/{z}/{x}/{y}, tolerating @2x and an extension. Same-origin only. The pattern is
// inlined, not a shared const, so the serialized worker matcher stays self-contained (file header).
export const isChartTile = ({ url, sameOrigin }: MatchContext): boolean =>
  sameOrigin && /^\/charts\/[^/]+\/\d+\/\d+\/\d+(?:@2x)?(?:\.\w+)?$/.test(url.pathname);

// The time-dynamic nowcoast layer families (weather radar mosaics, watches and warnings, active
// tropical cyclones, and sea surface temperature). They share the nowcoast host with the static
// BlueTopo bathymetry pair, so the WMS LAYERS (or WMTS LAYER) value is what separates them. The
// family list is inlined, not derived from the catalog, so the serialized worker matcher stays
// self-contained (file header); the catalog-derived test in sw-caching.test.ts keeps it honest.
// Workbox routes first-match, so this rule MUST stay listed before isOverlayTile in runtimeCaching;
// reorder them and a radar frame is served CacheFirst as current for 7 days.
export const isVolatileOverlayTile = ({ url }: MatchContext): boolean => {
  if (url.hostname !== 'nowcoast.noaa.gov') return false;
  for (const [name, value] of url.searchParams) {
    const param = name.toLowerCase();
    if (param !== 'layers' && param !== 'layer') continue;
    for (const layer of value.split(',')) {
      if (/^(?:weather_radar|alerts|tropical_cyclones|sea_surface_temperature):/.test(layer)) {
        return true;
      }
    }
  }
  return false;
};

// The cross-origin overlay tile and WMS hosts Binnacle renders (NOAA ENC and MPA, GEBCO, the two
// EMODnet services, BlueTopo via nowcoast, Marine Regions boundaries, OpenSeaMap seamarks, NASA
// GIBS, and Seascape). The host list is inlined, not a shared const, so the serialized worker matcher stays
// self-contained (file header). One shared cache with a 7 day TTL bounds chart-edition staleness.
// The nowcoast time-dynamic layers are carved out by isVolatileOverlayTile, listed first.
export const isOverlayTile = ({ url }: MatchContext): boolean =>
  url.hostname === 'gis.charttools.noaa.gov' ||
  url.hostname === 'nowcoast.noaa.gov' ||
  url.hostname === 'wms.gebco.net' ||
  url.hostname === 'ows.emodnet-bathymetry.eu' ||
  url.hostname === 'ows.emodnet-humanactivities.eu' ||
  url.hostname === 'geo.vliz.be' ||
  url.hostname === 'tiles.openseamap.org' ||
  url.hostname === 'gibs.earthdata.nasa.gov' ||
  url.hostname === 'tiles.openwaters.io';

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
export const runtimeCaching = [
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
