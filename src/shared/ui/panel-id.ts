// Leading chart panels share one closed union across the app shell and PlotterView. Keeping the
// routing contract here prevents stringly-typed panel names from drifting between composition and
// rendering while remaining independent of every feature implementation.
export type PanelId =
  | 'routes'
  | 'layers'
  | 'tracks'
  | 'waypoints'
  | 'tides'
  | 'trends'
  | 'ais'
  | 'anchor'
  | 'alarms'
  | 'poi-search'
  | 'profiles'
  | 'regions'
  | 'charts-management';
