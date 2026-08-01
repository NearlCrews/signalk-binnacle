import {
  catalogSource,
  createSafetyOverlay,
  type OverlayModule,
  type RasterOverlaySource,
} from '$shared/map';

// Maritime jurisdiction lines from Marine Regions (VLIZ), so a cruiser knows when a passage crosses
// into another country's waters: the maritime boundaries (the treaty and median lines between
// neighboring states), and the territorial sea at 12 nm where customs and clearance rules begin.
// They are independent toggles (you may want only the 12 nm line), both default hidden, and render
// as thin lines rather than full ocean fills. The catalog's bound-eez is the inter-state boundary
// set, not the 200 nm outer EEZ limit, which is why it is titled "Maritime boundaries".
//
// Every upstream fact comes from the shared catalog through catalogSource: the service URL, the
// layer name, the zoom range, and the attribution. Only the plain-language description, the region
// tag, and the panel category are ours to declare.
export const BOUNDARY_SOURCES: RasterOverlaySource[] = [
  catalogSource('bound-eez', {
    region: 'Global',
    category: 'reference',
    description: 'Lines marking the border between one country and the next at sea.',
  }),
  catalogSource('bound-12nm', {
    region: 'Global',
    category: 'reference',
    description: "The 12 nm limit where a country's customs and clearance rules begin.",
  }),
];

// The boundary lines draw in the safety band, bound through the shared createSafetyOverlay so the
// band is not re-spelled per slice.
export function createBoundaryOverlay(source: RasterOverlaySource): OverlayModule {
  return createSafetyOverlay(source);
}
