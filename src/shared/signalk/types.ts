// Local mirrors of the Signal K wire shapes. The @signalk/server-api package is
// server-side: its entry re-exports FullSignalK, which extends Node's EventEmitter,
// so bundling it into the browser worker crashes with "Class extends value
// undefined" once `events` is externalized. The client only needs these structural
// types, so it defines them here and never imports the package.
export type Path = string;
export type Context = string;
export type Value = unknown;

// The Signal K context for the server's own vessel, before the hello handshake
// reveals its MMSI URN. Single source of truth for the transport layer's routing.
export const SELF_CONTEXT = 'vessels.self';

// The wildcard context for every other vessel's deltas (AIS), the transport-layer sibling of
// SELF_CONTEXT; subscriptions filter self out of this stream.
export const ALL_VESSELS_CONTEXT: Context = 'vessels.*';

// The path prefix every raised notification shares. The store mirrors a cell when its path starts
// with this, and SK_PATHS.allNotifications is the wildcard subscription built from it.
export const NOTIFICATIONS_PREFIX = 'notifications.';

// The notification states that actually sound, alarm and emergency; nominal, normal, alert, and
// warn are the quiet grades. The narrow name says so, since the canonical NotificationState below
// carries all six grades; shared by every consumer that grades a notifications.* cell for an
// audible alarm (anchor drag, MOB). Built from a NotificationState[] literal so a typo in a member
// is a compile error, while the Set stays string-keyed so a raw notifications.* state reads cleanly.
const SOUNDING_STATES: readonly NotificationState[] = ['alarm', 'emergency'];
const SOUNDING_NOTIFICATION_STATES: ReadonlySet<string> = new Set(SOUNDING_STATES);

// The state string of a notifications.* value, or undefined when the value is absent, not an object,
// or carries no string state (a cleared v1 producer publishes null). Shared by every consumer that
// reads a raised notification's grade (anchor drag, MOB, the store mirror, the alert list).
export function notificationState(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = (value as { state?: unknown }).state;
  return typeof state === 'string' ? state : undefined;
}

// Whether a notifications.* value is in an audible grade (alarm or emergency). Shared so the audible
// alarms grade a cell through one predicate rather than re-deriving the state and the set membership.
export function isSoundingNotification(value: unknown): boolean {
  const state = notificationState(value);
  return state !== undefined && SOUNDING_NOTIFICATION_STATES.has(state);
}

// Whether a notifications.* value is currently raised: it carries a state string other than the
// quiet normal and nominal grades. The store mirror admits exactly these, and the reconnect
// reconcile keeps exactly these, so the two must share one predicate.
export function isRaisedNotificationValue(value: unknown): boolean {
  const state = notificationState(value);
  return typeof state === 'string' && state !== 'normal' && state !== 'nominal';
}

// The full Signal K alarm-state set (server-api ALARM_STATE). 'nominal' and 'normal' are the
// quiet grades; the rest escalate alert < warn < alarm < emergency.
export type NotificationState = 'nominal' | 'normal' | 'alert' | 'warn' | 'alarm' | 'emergency';

// The grades a raised notification carries: the escalating subset of NotificationState, excluding
// the quiet 'nominal' and 'normal'. A parsed active alert is always one of these.
export type RaisedNotificationState = Exclude<NotificationState, 'nominal' | 'normal'>;

// Sort rank for the raised grades; lower is more severe. Shared so the store's mirror bound and the
// alert list order a notification by the same scale. A state outside the table is not raised.
export const NOTIFICATION_SEVERITY_RANK: Record<RaisedNotificationState, number> = {
  emergency: 0,
  alarm: 1,
  warn: 2,
  alert: 3,
};

// How severe a raised notifications.* value is, or undefined when it is not raised at all.
export function notificationSeverityRank(value: unknown): number | undefined {
  const state = notificationState(value);
  return state !== undefined && Object.hasOwn(NOTIFICATION_SEVERITY_RANK, state)
    ? NOTIFICATION_SEVERITY_RANK[state as RaisedNotificationState]
    : undefined;
}

export interface PathValue {
  path: Path;
  value: Value;
}

// label is the human-readable display string (the source bus for hardware providers). ref is the
// update's $source reference, the server's per-source identity; the staleness enforcer keys its
// declarations by it, and two devices on one bus share a label but never a ref.
export interface PathSource {
  label?: string;
  ref?: string;
}

// Mirror of @signalk/server-api PathValueState: the out-of-band container the staleness enforcer
// attaches to its synthetic value-null delta when meta.timeout enforcement declares a path stale.
export interface PathValueState {
  timedOut?: boolean;
  lastValue?: { timestamp?: string; value?: Value };
}

// One parsed stale declaration the worker forwards per timed-out self path. Travels in its own
// frame channel so it can never refresh a freshness signal.
export interface PathStaleMarker {
  // The update's $source: which source the server declared stale (staleness is per source).
  sourceRef?: string;
  // The server's last good value, with its provider timestamp parsed to epoch ms when parseable
  // and clamped to the receipt clock.
  lastValue?: { value: Value; epoch?: number };
}

// What a PathCell retains while the server declares the path timed out. Cleared by any later self
// value for the path, null included: the server clears its own record on any accepted delta.
export interface ServerStaleRecord {
  sourceRef?: string;
  lastValueEpoch?: number;
}

interface DeltaUpdate {
  values?: PathValue[];
  source?: unknown;
  $source?: unknown;
  [key: string]: unknown;
}

export interface Delta {
  context?: Context;
  updates?: DeltaUpdate[];
  [key: string]: unknown;
}

export type ConnectionPhase = 'connecting' | 'open' | 'reconnecting' | 'closed';

// The one definition of "the stream is down" for every surface that labels or reacts to a broken
// connection, so a future phase cannot leave one panel silently claiming the stream is healthy.
export function isConnectionDown(phase: ConnectionPhase): boolean {
  return phase === 'reconnecting' || phase === 'closed';
}

// The mirror predicate: the socket is delivering. Not the negation of isConnectionDown, since
// 'connecting' is neither.
export function isConnectionOpen(phase: ConnectionPhase): boolean {
  return phase === 'open';
}

export interface ConnectionState {
  phase: ConnectionPhase;
  attempt: number;
}

// The state before the socket opens, shared by the store and the worker core so the
// initial literal lives in one place.
export const INITIAL_CONNECTION_STATE: ConnectionState = { phase: 'connecting', attempt: 0 };

// signalk-server's subscription manager honors only 'instant' and 'fixed'; any other policy
// (the spec's 'ideal') is rejected with an error and ignored (subscriptionmanager.ts), so the
// client never sends it.
export type SubscribePolicy = 'instant' | 'fixed';

export interface SubscribeEntry {
  path: Path;
  context?: Context;
  period?: number;
  minPeriod?: number;
  policy?: SubscribePolicy;
}

// One coalesced batch delivered from the worker to the main thread per frame. Both self and AIS are
// Maps, the shape the batcher already accumulates; Comlink structured-clones them across the worker
// boundary, so there is no per-path or per-context object to build on either side.
export interface SKFrame {
  self: Map<string, Value>;
  selfSources?: Map<string, PathSource>;
  selfEpochs?: Map<string, number>;
  // Server-declared staleness markers, one per timed-out self path. A separate channel from self
  // on purpose: a marker must not stamp an epoch or read as data flow.
  selfStales?: Map<string, PathStaleMarker>;
  ais?: Map<string, Map<string, Value>>;
  aisEpochs?: Map<string, Map<string, number>>;
  connection: ConnectionState;
  epoch: number;
  // Changes on every successful WebSocket open. Consumers retain safety latches across a
  // reconnect, but reject ordinary telemetry stamped by an older connection generation.
  generation?: number;
  // The server-assigned own-vessel context from hello (vessels.urn:...), once known, so the main
  // thread can exclude self from context-keyed REST responses (the AIS trails).
  selfContext?: string;
}

// An accumulated AIS target: the latest value seen per path, plus the epoch of
// the most recent update for staleness pruning.
export interface AisTargetState {
  values: Map<string, Value>;
  epochs: Map<string, number>;
  generations: Map<string, number>;
  lastUpdate: number;
  // Bumped only when a mirrored value actually changes, so a consumer can memoize per target
  // without re-deriving what changed. Deliberately not lastUpdate: an identical republish advances
  // freshness without changing anything renderable, and two frames can share a millisecond.
  revision: number;
}

// Mirrors the Signal K v2 navigation.course shapes Binnacle reads. Units: meters, radians, m/s,
// seconds, ISO 8601, positions decimal degrees. Never import @signalk/server-api in browser code.
export interface CoursePoint {
  type?: string;
  href?: string;
  name?: string;
  position?: { latitude: number; longitude: number };
}
export interface ActiveRoute {
  href?: string;
  pointIndex?: number;
  pointTotal?: number;
  reverse?: boolean;
  name?: string;
}
export interface CourseInfo {
  arrivalCircle?: number; // meters
  activeRoute?: ActiveRoute;
  nextPoint?: CoursePoint;
  previousPoint?: CoursePoint;
  startTime?: string;
  targetArrivalTime?: string | null;
}
export interface CourseCalculations {
  calcMethod?: 'GreatCircle' | 'Rhumbline';
  crossTrackError?: number | null; // meters
  bearingTrackTrue?: number | null; // radians
  distance?: number | null; // meters to next point
  bearingTrue?: number | null; // radians to next point
  velocityMadeGood?: number | null; // m/s
  timeToGo?: number | null; // seconds
  estimatedTimeOfArrival?: string | null; // ISO 8601
}

export interface SignalKClientApi {
  connect(url: string, onFrame: (frame: SKFrame) => void): Promise<void>;
  // Point the next socket attempt at a new URL without touching a healthy live socket. The
  // connection reads its URL at connect time, so a changed auth token pushed here takes effect on
  // the next reconnect instead of freezing the connect-time token for the session.
  setUrl(url: string): Promise<void>;
  subscribe(entries: SubscribeEntry[]): Promise<void>;
  unsubscribe(paths: Path[], context?: Context): Promise<void>;
  // Send a client delta to the server (e.g. to publish a notification). Dropped if the
  // socket is not open, with no transport-level replay; the producer resends on its next
  // changed value.
  publish(delta: Delta): Promise<void>;
  // Reconnect now, resetting the backoff. Used when the OS reports the network is back, so a long
  // outage does not wait out the full backoff delay before the next attempt.
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
}
