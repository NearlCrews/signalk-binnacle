import { CHART_SOURCES, type ChartSource } from 'signalk-chart-sources';
import { describe, expect, it } from 'vitest';
import { BINNACLE_CACHE_NAMES } from '$shared/privacy';
import {
  isBasemapAsset,
  isBasemapStyle,
  isChartTile,
  isCoopsRequest,
  isOverlayTile,
  isRadarIndex,
  isRadarTile,
  isVolatileOverlayTile,
  runtimeCaching,
} from './sw-caching';

const ctx = (url: string, sameOrigin = false) => ({ url: new URL(url), sameOrigin });

// The catalog's own URL for a source, whichever shape its mode carries. The matchers read the host
// and, on the nowcoast host, the LAYERS parameter, so a WMS base gets the same LAYERS value its
// GetMap requests carry, and an unexpanded {z}/{x}/{y} template parses fine.
function upstreamUrl(source: ChartSource): string {
  const upstream = source.upstream;
  switch (upstream.mode) {
    case 'style':
      return upstream.styleUrl;
    case 'wms':
      return `${upstream.base}?SERVICE=WMS&REQUEST=GetMap&LAYERS=${upstream.layers}`;
    case 'arcgis':
      return upstream.base;
    default:
      return upstream.urlTemplate;
  }
}

describe('service worker route matchers', () => {
  it('matches the base style separately from base tiles', () => {
    expect(isBasemapStyle(ctx('https://tiles.openfreemap.org/styles/liberty'))).toBe(true);
    expect(isBasemapStyle(ctx('https://tiles.openfreemap.org/planet/1/1/1.pbf'))).toBe(false);
    expect(isBasemapAsset(ctx('https://tiles.openfreemap.org/planet/1/1/1.pbf'))).toBe(true);
    expect(isBasemapAsset(ctx('https://example.com/styles/liberty'))).toBe(false);
  });

  // Every host below is also owned by the catalog, but the matchers must keep their own copies: the
  // build serializes each one through Function.toString without its module scope, so a matcher that
  // closed over an import would throw ReferenceError in the worker (see the file header). A copy is
  // only safe while something checks it, because a catalog host move would otherwise stop matching
  // and switch that layer's offline caching off on a green build. These two are that check.
  it('routes every style-mode catalog source as a base style', () => {
    const styles = CHART_SOURCES.filter((source) => source.upstream.mode === 'style');
    expect(styles.length).toBeGreaterThan(0);
    for (const source of styles) {
      const request = ctx(upstreamUrl(source));
      expect(isBasemapStyle(request), `${source.id} is not routed as a base style`).toBe(true);
      expect(isBasemapAsset(request), `${source.id} is not routed as a base asset`).toBe(true);
    }
  });

  it('routes every other catalog source as an overlay tile, volatile ones never the 7-day cache', () => {
    for (const source of CHART_SOURCES) {
      if (source.upstream.mode === 'style' || source.maxAgeSeconds !== undefined) continue;
      const request = ctx(upstreamUrl(source));
      expect(
        isOverlayTile(request),
        `${source.id} (${request.url.hostname}) is cached by no runtime route`,
      ).toBe(true);
      expect(isVolatileOverlayTile(request), `${source.id} is wrongly routed as time-dynamic`).toBe(
        false,
      );
    }
  });

  it('routes every time-dynamic catalog source through the short-lived NetworkFirst cache', () => {
    const volatile = CHART_SOURCES.filter((source) => source.maxAgeSeconds !== undefined);
    expect(volatile.length).toBeGreaterThan(0);
    for (const source of volatile) {
      const request = ctx(upstreamUrl(source));
      // First-match routing: the first rule claiming the request must be the volatile one, so the
      // overlapping 7-day nowcoast route can never serve a stale frame as current.
      const route = runtimeCaching.find((entry) =>
        (entry.urlPattern as (c: typeof request) => boolean)(request),
      );
      expect(route?.options.cacheName, `${source.id} is not routed as time-dynamic`).toBe(
        'binnacle-volatile-overlays',
      );
      expect(route?.handler).toBe('NetworkFirst');
      expect(route?.options.expiration.maxAgeSeconds).toBeLessThanOrEqual(60 * 60);
    }
  });

  it('reads the layer parameter shape a WMS or WMTS request carries', () => {
    // Synthetic layer names: the matcher's parameter handling is what is under test here; the real
    // family names are covered by the catalog-derived tests above.
    expect(
      isVolatileOverlayTile(ctx('https://nowcoast.noaa.gov/g/ows?layers=weather_radar:x')),
    ).toBe(true);
    expect(
      isVolatileOverlayTile(ctx('https://nowcoast.noaa.gov/g/wmts?LAYER=alerts:x&STYLE=')),
    ).toBe(true);
    expect(
      isVolatileOverlayTile(ctx('https://nowcoast.noaa.gov/g/ows?LAYERS=bluetopo:a,alerts:x')),
    ).toBe(true);
    expect(isVolatileOverlayTile(ctx('https://nowcoast.noaa.gov/g/ows?LAYERS=bluetopo:a'))).toBe(
      false,
    );
    expect(isVolatileOverlayTile(ctx('https://example.com/ows?LAYERS=weather_radar:x'))).toBe(
      false,
    );
  });

  it('matches plugin chart tiles only same-origin and only tile-shaped paths', () => {
    expect(isChartTile(ctx('https://boat/charts/noaa-13278/12/1234/1521', true))).toBe(true);
    expect(isChartTile(ctx('https://boat/charts/x/3/4/5@2x.png', true))).toBe(true);
    expect(isChartTile(ctx('https://boat/charts/noaa-13278/12/1234/1521', false))).toBe(false);
    expect(isChartTile(ctx('https://boat/charts/list', true))).toBe(false);
    expect(isChartTile(ctx('https://boat/signalk/v2/api/resources/charts', true))).toBe(false);
  });

  it('matches the overlay hosts and nothing else', () => {
    expect(isOverlayTile(ctx('https://gis.charttools.noaa.gov/arcgis/anything'))).toBe(true);
    expect(isOverlayTile(ctx('https://tiles.openseamap.org/seamark/10/1/1.png'))).toBe(true);
    expect(isOverlayTile(ctx('https://tiles.openwaters.io/seascape/10/1/1.webp'))).toBe(true);
    expect(isOverlayTile(ctx('https://gibs.earthdata.nasa.gov/wmts/2026-06-01/1/1/1.png'))).toBe(
      true,
    );
    expect(isOverlayTile(ctx('https://tiles.openfreemap.org/planet/1/1/1.pbf'))).toBe(false);
  });

  it('matches CO-OPS and the radar shapes', () => {
    expect(isCoopsRequest(ctx('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'))).toBe(
      true,
    );
    expect(isRadarIndex(ctx('https://api.rainviewer.com/public/weather-maps.json'))).toBe(true);
    expect(
      isRadarTile(ctx('https://tilecache.rainviewer.com/v2/radar/1/256/5/1/1/1/1_1.png')),
    ).toBe(true);
    expect(isRadarTile(ctx('https://api.rainviewer.com/public/weather-maps.json'))).toBe(false);
  });

  it('does not cache Open-Meteo JSON and rejects radar lookalike hosts', () => {
    const weather = [
      ctx('https://api.open-meteo.com/v1/forecast?latitude=44'),
      ctx('https://marine-api.open-meteo.com/v1/marine'),
    ];
    for (const entry of runtimeCaching) {
      for (const request of weather) {
        expect((entry.urlPattern as (c: typeof request) => boolean)(request)).toBe(false);
      }
    }
    expect(isRadarIndex(ctx('https://notrainviewer.com/maps.json'))).toBe(false);
  });

  it('never routes the Signal K APIs and never caches opaque responses', () => {
    const apis = [
      ctx('https://boat/signalk/v2/api/resources/routes', true),
      ctx('https://boat/signalk/v1/api/vessels/self', true),
    ];
    for (const entry of runtimeCaching) {
      for (const api of apis) {
        expect((entry.urlPattern as (c: typeof api) => boolean)(api)).toBe(false);
      }
      const statuses = entry.options.cacheableResponse.statuses;
      expect(statuses).toEqual([200]);
    }
  });

  it('bounds every cache with entries and an age', () => {
    for (const entry of runtimeCaching) {
      expect(entry.options.expiration.maxEntries).toBeGreaterThan(0);
      expect(entry.options.expiration.maxAgeSeconds).toBeGreaterThan(0);
    }
  });

  it('keeps the base style cached at least as long as the tiles it references', () => {
    // A style expiring before its tiles blanks the base map on a long offline stretch even though
    // the tiles are still cached; revalidation already bounds online staleness.
    const ageOf = (pattern: unknown): number =>
      runtimeCaching.find((e) => e.urlPattern === pattern)?.options.expiration.maxAgeSeconds ?? 0;
    expect(ageOf(isBasemapStyle)).toBeGreaterThan(0);
    expect(ageOf(isBasemapStyle)).toBeGreaterThanOrEqual(ageOf(isBasemapAsset));
  });

  it('lists every runtime cache in the privacy erase inventory', () => {
    // The erase inventory is a deliberately explicit mirror (no owner enumerates caches
    // dynamically at erase time), so this seam pins it: a new route whose cache is missing there
    // would survive a device-data erase while the erase reports success.
    const inventory: readonly string[] = BINNACLE_CACHE_NAMES;
    for (const entry of runtimeCaching) {
      expect(inventory).toContain(entry.options.cacheName);
    }
  });
});
