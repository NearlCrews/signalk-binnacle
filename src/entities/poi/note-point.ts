import { isPoiCategory, type PoiCategory } from '$entities/poi-icons';
import { isLatLon } from '$shared/geo';

// A point-of-interest note from the Signal K resources API. Providers like signalk-crows-nest
// serve marinas, anchorages, and hazards as `notes`. Owned by entities because two features render
// the same shape (the notes overlay and the POI search panel), and cross-feature data flows
// through entities, never feature to feature.
export interface NotePoint {
  id: string;
  name: string;
  position: { latitude: number; longitude: number };
  category: PoiCategory;
  // Plain-text note content. Provider markup is never retained in the chart or search model.
  description?: string;
  // The provider's raw icon reference, kept alongside the derived category so a provided
  // symbol (signalk-symbol-manager) can resolve it to a custom marker.
  skIcon?: string;
  // True only for the exact, versioned Binnacle ownership marker. It is never inferred from the
  // source name, provider id, icon, or another mutable display field.
  ownedByBinnacle?: boolean;
  // Optional credit and link surfaced for the marker and its detail panel.
  url?: string;
  source?: string;
  attribution?: string;
}

// The live relationship between the chart viewport and its notes provider. Kept with NotePoint so
// the notes overlay can report it through the composition root without importing the search feature.
export type PoiViewPhase = 'idle' | 'hidden' | 'zoomed-out' | 'loading' | 'ready' | 'error';

export interface PoiViewState {
  phase: PoiViewPhase;
  // True when the displayed set came from local cache while the device was offline. A cached set is
  // useful underway, but the navigator still needs to know that it may not contain recent changes.
  offline: boolean;
}

// Validate a cross-reload cached point before it reaches search math or MapLibre. IndexedDB values
// are untyped at runtime and can outlive an older schema or become corrupt.
export function isNotePoint(value: unknown): value is NotePoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<NotePoint>;
  return (
    typeof point.id === 'string' &&
    point.id.length > 0 &&
    point.id.length <= 512 &&
    typeof point.name === 'string' &&
    point.name.length > 0 &&
    point.name.length <= 256 &&
    isLatLon(point.position) &&
    typeof point.category === 'string' &&
    isPoiCategory(point.category) &&
    (point.description === undefined ||
      (typeof point.description === 'string' && point.description.length <= 4_000)) &&
    (point.skIcon === undefined ||
      (typeof point.skIcon === 'string' && point.skIcon.length <= 256)) &&
    (point.ownedByBinnacle === undefined || typeof point.ownedByBinnacle === 'boolean') &&
    (point.url === undefined || (typeof point.url === 'string' && point.url.length <= 2048)) &&
    (point.source === undefined ||
      (typeof point.source === 'string' && point.source.length <= 256)) &&
    (point.attribution === undefined ||
      (typeof point.attribution === 'string' && point.attribution.length <= 1024))
  );
}
