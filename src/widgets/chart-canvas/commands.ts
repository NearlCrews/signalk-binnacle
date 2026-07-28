import type { Route } from '$entities/route';
import type { Bbox4, LatLon } from '$shared/geo';
import type { LayerSettings, SignalKChart } from '$shared/map';

// Imperative map actions the chart exposes to the app shell (e.g. for menu items),
// handed up once the map is ready.
export interface MapCommands {
  centerOnVessel: () => void;
  // Pan to a position at the current zoom, with no animation, for the follow lock that keeps
  // the boat centered as it moves. Unlike centerOnVessel it never changes the zoom.
  recenterOnVessel: (latitude: number, longitude: number) => void;
  // Ring the POI marker at a position, or clear the ring with undefined. Drives the chart highlight
  // from a selected or hovered note: a map-marker click, or a POI search result. Never moves the map.
  highlightPoi: (position: LatLon | undefined) => void;
  // Fly the map to a position (for example a route's start) at a usable zoom, animated.
  flyTo: (latitude: number, longitude: number) => void;
  // Fit the map to a [west, south, east, north] bounding box, animated; used after importing a
  // chart so the imported area comes into view.
  fitBounds: (bounds: Bbox4) => void;
  // The current viewport as a [west, south, east, north] box, read straight from the map, for code
  // that needs the visible area (for example scoping an AI route draft's nearby notes and POIs).
  getBounds: () => Bbox4;
  // Start on-chart route editing (Terra Draw): with a route, edit it; without one, draw a fresh
  // route. An initialPoint seeds the first waypoint of a fresh route at a chosen spot ("Start a route
  // here"). stopRouteEdit tears the editor down.
  startRouteEdit: (route?: Route, initialPoint?: LatLon) => void;
  stopRouteEdit: () => void;
  // Apply a full per-layer visibility/opacity snapshot and stacking order to the nav chart at
  // runtime, so switching a profile updates the chart without a remount.
  applyLayers: (settings: LayerSettings, order: string[]) => void;
}

// Register or remove a user-imported chart overlay once the map is ready. The app drives this
// from the user-charts entity, resolving each chart's tile url before calling register.
export interface UserChartRegistrar {
  register: (chart: SignalKChart) => Promise<void>;
  replace: (chart: SignalKChart) => Promise<void>;
  unregister: (identifier: string) => void;
}
