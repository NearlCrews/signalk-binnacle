import { describe, expect, it } from 'vitest';
import { baseStyleUrl, fallbackBaseStyle } from './base-style';
import { BASEMAP_SOURCE_ID, requireCatalogSource } from './catalog';

describe('fallbackBaseStyle', () => {
  it('is a valid one-layer style so the map can fire load without any network', () => {
    const style = fallbackBaseStyle();
    expect(style.version).toBe(8);
    expect(style.sources).toEqual({});
    expect(style.layers).toHaveLength(1);
    expect(style.layers[0]).toMatchObject({ id: 'background', type: 'background' });
  });

  it('declares glyphs from the base host so symbol layers with text can still be added', () => {
    const style = fallbackBaseStyle();
    expect(style.glyphs).toContain('{fontstack}');
    expect(new URL(style.glyphs as string).host).toBe(new URL(baseStyleUrl()).host);
  });
});

describe('baseStyleUrl', () => {
  // Equality, not a host substring: the service worker decides what to cache from the catalog's own
  // styleUrl, so this is the link that makes those two assertions describe one URL. Weaken it and a
  // catalog style path change would leave the base map uncached with nothing failing.
  it('returns the catalog style URL when there is no companion', () => {
    const styleUrl = requireCatalogSource(BASEMAP_SOURCE_ID, 'style').upstream.styleUrl;
    expect(baseStyleUrl()).toBe(styleUrl);
    expect(baseStyleUrl(null)).toBe(styleUrl);
  });

  it('returns the companion-proxied basemap style when the companion is present', () => {
    expect(baseStyleUrl('http://boat.local/plugins/signalk-chart-locker')).toBe(
      'http://boat.local/plugins/signalk-chart-locker/style/basemap',
    );
  });
});
