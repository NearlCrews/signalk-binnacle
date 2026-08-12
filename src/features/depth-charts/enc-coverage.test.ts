import { describe, expect, it } from 'vitest';
import { requireCatalogSource } from '$shared/map';
import {
  type EncPromptConditions,
  NOAA_ENC_SOURCE_ID,
  noaaEncCoversPosition,
  shouldOfferNoaaEnc,
} from './enc-coverage';

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

describe('shouldOfferNoaaEnc', () => {
  // Tampa Bay with a reference base map on and nothing else: the one state the offer exists for.
  const offered: EncPromptConditions = {
    dismissed: false,
    emergencyActive: false,
    panelOpen: false,
    layers: [{ visible: true }],
    position: { latitude: 27.7, longitude: -82.7 },
    positionStale: false,
  };

  it('offers the chart to a boat in covered waters with no navigation chart on', () => {
    expect(shouldOfferNoaaEnc(offered)).toBe(true);
  });

  it.each<[string, Partial<EncPromptConditions>]>([
    ['already dismissed', { dismissed: true }],
    ['an emergency owns the screen', { emergencyActive: true }],
    // The regression: an open panel must suppress the offer, and only an open one.
    ['a panel is docked', { panelOpen: true }],
    ['the layer list has not resolved', { layers: undefined }],
    ['a navigation chart is already visible', { layers: [{ visible: true, chart: {} }] }],
    ['there is no fix', { position: undefined }],
    ['the fix is stale', { positionStale: true }],
    ['the fix is outside NOAA coverage', { position: { latitude: -20, longitude: 75 } }],
  ])('stays quiet when %s', (_reason, override) => {
    expect(shouldOfferNoaaEnc({ ...offered, ...override })).toBe(false);
  });
});
