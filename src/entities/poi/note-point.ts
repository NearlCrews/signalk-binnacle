import type { PoiCategory } from '$entities/poi-icons';

// A point-of-interest note from the Signal K resources API. Providers like signalk-crows-nest
// serve marinas, anchorages, and hazards as `notes`. Owned by entities because two features render
// the same shape (the notes overlay and the POI search panel), and cross-feature data flows
// through entities, never feature to feature.
export interface NotePoint {
  id: string;
  name: string;
  position: { latitude: number; longitude: number };
  category: PoiCategory;
  // The provider's raw icon reference, kept alongside the derived category so a provided
  // symbol (signalk-symbol-manager) can resolve it to a custom marker.
  skIcon?: string;
  // Optional credit and link surfaced for the marker and its detail panel.
  url?: string;
  source?: string;
  attribution?: string;
}
