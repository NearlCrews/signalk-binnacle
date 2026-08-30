// The Signal K v2 radar API shapes Binnacle consumes, mirrored from `@signalk/server-api`'s radarapi
// types. That package is never imported in browser or worker code (its barrel pulls in Node's
// EventEmitter via FullSignalK), so the few wire types live here. The server serves these at
// `/signalk/v2/api/vessels/self/radars`; a Radar API provider, such as Mayara, populates them.

import type { LatLon } from '$shared/geo';

export type RadarStatus = 'off' | 'standby' | 'transmit' | 'warming';
export type RadarAvailability =
  | 'idle'
  | 'probing'
  | 'available'
  | 'absent'
  | 'auth-required'
  | 'unreachable'
  | 'invalid';

// The pending-set key for an in-flight transmit/standby write. Shared by the controller (which marks
// it pending on setPower) and the store (which skips it in reconcile), so the optimistic-write guard
// cannot break by the two sides spelling the sentinel differently, and it cannot collide with a real
// control id.
export const POWER_PENDING_KEY = 'power';

// The control ids providers use for the radar's operational power state. Both spellings drive the
// TX/Standby pill and stream gating, and both are excluded from the generic controls list. The
// pending sentinel for the dedicated power write stays POWER_PENDING_KEY alone.
export const POWER_CONTROL_IDS: ReadonlySet<string> = new Set(['power', 'status']);

// A live control value. `auto` is present on controls that support an automatic mode (gain, sea); a
// value-only control (rain on some radars) omits it.
type RadarControlScalar = number | string | boolean;

export interface RadarControlEntry {
  value?: RadarControlScalar;
  auto?: boolean;
  autoValue?: number;
  enabled?: boolean;
  endValue?: number;
  startDistance?: number;
  endDistance?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  width?: number;
  allowed?: boolean;
}

// The complete native Radar API guard-zone value. Angles are heading-relative radians, distances are
// meters, and enabled is configuration state rather than write permission or an alarm indication.
export interface RadarZoneValue {
  value: number;
  endValue: number;
  startDistance: number;
  endDistance: number;
  enabled: boolean;
}

// A native sector is a heading-relative angular envelope. Mayara uses this shape for no-transmit
// sectors, so changing it always requires the explicit emission-safety confirmation in the panel.
export interface RadarSectorValue {
  value: number;
  endValue: number;
  enabled: boolean;
}

// A native rectangle uses local east and north offsets from the radar in meters. The first two
// points form one edge, and width extends clockwise, perpendicular to that edge.
export interface RadarRectValue {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  enabled: boolean;
}

export type RadarStructuredValue = RadarZoneValue | RadarSectorValue | RadarRectValue;
export type RadarAreaType = 'sector' | 'zone' | 'rect';

export interface RadarAreaDraft {
  radarId: string;
  controlId: string;
  type: RadarAreaType;
  value: RadarStructuredValue;
  chartEditing: boolean;
  chartStep: number;
  chartError?: string;
}

// Current control settings keyed by control id, as reported in RadarInfo.controls.
export type RadarControls = Record<string, RadarControlEntry | undefined>;

// One color stop in a radar's display legend. `minValue`/`maxValue` bound the raw spoke sample values
// this color covers; when absent the entry index is the sample value.
export interface LegendEntry {
  color: string;
  label: string;
  minValue?: number;
  maxValue?: number;
}

// A radar as listed by GET /signalk/v2/api/vessels/self/radars (the array elements).
export interface RadarInfo {
  id: string;
  name: string;
  brand?: string;
  status: RadarStatus;
  spokesPerRevolution: number;
  maxSpokeLen: number;
  range: number;
  controls: RadarControls;
  legend?: LegendEntry[];
  // WebSocket URL for the protobuf spoke stream. When absent the built-in stream at
  // `<radar>/stream` is used.
  streamUrl?: string;
}

// A control definition from GET /radars/{id}/capabilities, used to render the controls UI. Enum values
// are numeric on the wire (the spoke control domain is integer indices), so the internal type pins
// `value` to number; both capability dialects coerce to it.
export interface ControlDefinition {
  id: string;
  name: string;
  description?: string;
  // Only the object-keyed native dialect defines the sector, zone, and rectangle wire shapes.
  // Keeping the dialect explicit prevents an arbitrary V5 compound control from gaining an editor.
  dialect: 'native' | 'v5' | 'fallback';
  type:
    | 'boolean'
    | 'number'
    | 'enum'
    | 'string'
    | 'button'
    | 'sector'
    | 'zone'
    | 'rect'
    | 'compound';
  range?: { min: number; max: number; step?: number; unit?: string };
  values?: Array<{ value: number | string; label: string }>;
  modes?: Array<'auto' | 'manual'>;
  readOnly?: boolean;
  category?: string;
  order?: number;
  hasEnabled?: boolean;
  maxDistance?: number;
}

// The subset of GET /radars/{id}/capabilities Binnacle reads.
export interface RadarCapabilities {
  controls: ControlDefinition[];
}

// A tracked ARPA or MARPA target from GET /radars/{id}/targets, reduced to what Binnacle consumes.
// Verified against signalk-server 2.27.0's radar API route and the Mayara 3.7.0 tracker source:
// motion is omitted until the tracker's motion estimate converges, danger (cpa and tcpa) is omitted
// when the relative motion is undefined, and a negative tcpa means the closest approach has already
// passed. Targets reported 'lost' are dropped at the parse, so this status never carries it.
export interface RadarTarget {
  id: number;
  status: 'tracking' | 'acquiring';
  position: LatLon;
  courseRad?: number;
  speedMps?: number;
  cpaMeters?: number;
  tcpaSeconds?: number;
}
