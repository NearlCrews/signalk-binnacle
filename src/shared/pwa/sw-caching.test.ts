import { describe, expect, it } from 'vitest';
import {
  isBasemapAsset,
  isBasemapStyle,
  isChartTile,
  isCoopsRequest,
  isOverlayTile,
  isRadarIndex,
  isRadarTile,
  runtimeCaching,
} from './sw-caching';

const ctx = (url: string, sameOrigin = false) => ({ url: new URL(url), sameOrigin });

describe('service worker route matchers', () => {
  it('matches the base style separately from base tiles', () => {
    expect(isBasemapStyle(ctx('https://tiles.openfreemap.org/styles/liberty'))).toBe(true);
    expect(isBasemapStyle(ctx('https://tiles.openfreemap.org/planet/1/1/1.pbf'))).toBe(false);
    expect(isBasemapAsset(ctx('https://tiles.openfreemap.org/planet/1/1/1.pbf'))).toBe(true);
    expect(isBasemapAsset(ctx('https://example.com/styles/liberty'))).toBe(false);
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
});
