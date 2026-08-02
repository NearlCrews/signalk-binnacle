import {
  catalogSource,
  createSafetyOverlay,
  type OverlayModule,
  type RasterOverlaySource,
} from '$shared/map';

// Seabed infrastructure from EMODnet Human Activities, so a cruiser sees what is on the bottom
// before the anchor goes down. This is anchoring information first and chart decoration second:
// dragging across a submarine power or telecom cable can part it, and anchoring on one is both a
// serious hazard and, in most jurisdictions, an offense. Pipelines carry the same rule. Wind farms
// matter for a different reason, which is that their arrays and export cables are usually
// no-anchor and often no-entry.
//
// All default hidden and render in the safety band, like the boundary and protected-area lines. The
// cable sets reach well beyond Europe despite the source name, which is why they carry a global
// region tag while the pipeline and wind-farm sets, which do not, are tagged EU.
//
// Every upstream fact comes from the shared catalog through catalogSource: the service URL, the
// layer name, the zoom range, the bounds, and the attribution. Only the plain-language description,
// the region tag, and the panel category are ours to declare.
export const INFRASTRUCTURE_SOURCES: RasterOverlaySource[] = [
  catalogSource('infra-power-cables', {
    region: 'Global',
    category: 'reference',
    description: 'Submarine power cables. Do not anchor on one: dragging can part it.',
  }),
  catalogSource('infra-telecom-cables', {
    region: 'Global',
    category: 'reference',
    description: 'Submarine telecom cables, which carry the same no-anchor rule as power cables.',
  }),
  catalogSource('infra-pipelines', {
    region: 'EU',
    category: 'reference',
    description: 'Seabed pipelines, which are no-anchor and often marked on the chart as such.',
  }),
  catalogSource('infra-wind-farms', {
    region: 'EU',
    category: 'reference',
    description:
      'Offshore wind farms, whose arrays and export cables are usually closed to anchoring.',
  }),
];

// These draw in the safety band, bound through the shared createSafetyOverlay so the band is not
// re-spelled per slice.
export function createInfrastructureOverlay(source: RasterOverlaySource): OverlayModule {
  return createSafetyOverlay(source);
}
