import { describe, expect, it } from 'vitest';
import { requireCatalogSource } from '$shared/map';
import { NOAA_ENC_SOURCE_ID, noaaEncCoversPosition } from './enc-coverage';

describe('noaaEncCoversPosition', () => {
  it('grades against the catalog coverage boxes, not the service envelope', () => {
    const source = requireCatalogSource(NOAA_ENC_SOURCE_ID);
    // The upstream envelope is near-worldwide, so a coverage list is what makes the prompt honest.
    expect(source.coverage?.length).toBeGreaterThan(1);
    // Tampa Bay is inside the US East and Gulf box; mid-Indian-Ocean is inside no box, even though
    // the service bounds would claim it.
    expect(noaaEncCoversPosition({ latitude: 27.7, longitude: -82.7 })).toBe(true);
    expect(noaaEncCoversPosition({ latitude: -20, longitude: 75 })).toBe(false);
  });

  it('answers for every coverage box, including any that crosses the antimeridian', () => {
    const coverage = requireCatalogSource(NOAA_ENC_SOURCE_ID).coverage ?? [];
    for (const [west, south, east, north] of coverage) {
      // A crossing box has a west greater than its east, so walk east the short way and wrap.
      const span = west <= east ? east - west : east + 360 - west;
      const raw = west + span / 2;
      const midLon = raw > 180 ? raw - 360 : raw;
      expect(noaaEncCoversPosition({ latitude: (south + north) / 2, longitude: midLon })).toBe(
        true,
      );
    }
  });
});
