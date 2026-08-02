import {
  catalogSource,
  createSafetyOverlay,
  type OverlayModule,
  type RasterOverlaySource,
} from '$shared/map';

// Marine protected and regulated areas, so a cruiser sees no-anchor and protected zones before
// dropping the hook. EMODnet Human Activities covers EU seas (marine protected areas, with Natura
// 2000 nested under it as a facet); the NOAA MPA Inventory covers US waters from the same host as the
// NOAA chart. The two authorities cover different regions, so they are not grouped together. All
// default hidden.
//
// Every upstream fact comes from the shared catalog through catalogSource, including the bounds.
// This module used to hardcode the NOAA box as [-180, 15, -60, 75], which excluded Guam, the
// Northern Mariana Islands, American Samoa, Wake Island, and the Pacific Remote Islands: the overlay
// simply did not draw there. The catalog now derives that coverage from the inventory's own
// geometry, so reading it is what fixes the gap and what keeps it fixed.
export const MPA_SOURCES: RasterOverlaySource[] = [
  catalogSource('mpa-emodnet', {
    region: 'EU',
    category: 'reference',
    description:
      'EU protected and regulated sea areas, so you see no-anchor zones before you stop.',
  }),
  catalogSource('mpa-natura2000', {
    region: 'EU',
    parent: 'mpa-emodnet',
    description: 'The EU Natura 2000 network of protected nature sites.',
  }),
  catalogSource('mpa-noaa', {
    region: 'US',
    category: 'reference',
    description: 'US marine protected areas from the NOAA inventory.',
  }),
  // The first protected-area layer here that is not regional: it covers marine World Heritage sites
  // anywhere, so it stays useful on a passage that leaves both the EU and US sets behind.
  catalogSource('mpa-unesco', {
    region: 'Global',
    category: 'reference',
    description: 'UNESCO World Heritage sites at sea, which usually carry their own restrictions.',
  }),
];

// The protected-area overlays draw in the safety band, bound through the shared createSafetyOverlay
// so the band is not re-spelled per slice.
export function createMpaOverlay(source: RasterOverlaySource): OverlayModule {
  return createSafetyOverlay(source);
}
