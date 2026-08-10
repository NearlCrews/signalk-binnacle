// The whole-route distance and time to go shown on the nav strip when a multi-leg route is active.
// Undefined for a single leg, where the per-leg readouts already say it. Shared by the nav strip
// prop and the App-side derive that fills it, so the shape has one definition.
export interface RouteProgress {
  distanceToGoMeters: number;
  timeToGoSeconds?: number;
  // How the time was built: the active leg's server or VMG estimate plus the planning speed for
  // the legs ahead. Never a weather-, current-, tack-, or polar-aware passage estimate.
  basis?: 'server-plan' | 'vmg-plan';
}
