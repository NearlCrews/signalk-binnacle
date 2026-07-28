// All values are SI: height in meters, velocity in m/s, time as Unix milliseconds, and position in
// decimal degrees. NOAA CO-OPS is the source, so this is US and territories only.

// The tide and current prediction window, the current UTC day plus this many hours, so the next
// high and low are always present even late in the day. Shared so the CO-OPS and signalk-tides
// sources trim to the same span and their curves and readouts agree.
export const TIDE_WINDOW_HOURS = 48;
export const MAX_NEARBY_STATIONS = 8;

export interface TideStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export type TideStationKind = 'tide' | 'current';

export interface NearbyTideStation {
  station: TideStation;
  // Straight-line distance from the current chart center, not sailing distance or an indication
  // that the station represents the local water movement.
  distanceMeters: number;
}

export type TideStationSelection =
  | { mode: 'automatic' }
  | {
      mode: 'manual';
      station: TideStation;
      distanceMeters: number;
    };

export interface TideSelectionSnapshot {
  tide: TideStationSelection;
  current: TideStationSelection;
}

export interface TideStationLoadFailure {
  kind: TideStationKind;
  requested: TideStationSelection;
}

export interface TideEvent {
  timeMs: number;
  heightMeters: number;
  kind: 'high' | 'low';
}

export interface CurrentEvent {
  timeMs: number;
  velocityMps: number;
  // The mean set of the stream in radians true (SI), present for flood and ebb, absent at slack.
  directionRad: number | undefined;
  kind: 'flood' | 'ebb' | 'slack';
}

export interface TideReading {
  station: TideStation;
  distanceMeters: number;
  events: TideEvent[];
}

export interface CurrentReading {
  station: TideStation;
  distanceMeters: number;
  events: CurrentEvent[];
}

export type TidesStatus = 'idle' | 'loading' | 'ready' | 'error' | 'no-coverage';

// Which source served the readings: the signalk-tides server plugin when installed, else NOAA
// CO-OPS fetched browser-side. The panel surfaces it as a quiet provenance note.
export type TidesSource = 'signalk-tides' | 'noaa-coops';
