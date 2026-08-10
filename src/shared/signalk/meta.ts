import { isFiniteNumber, isRecord } from '$shared/lib';
import { fetchAuthedJson } from './resource';

// The display states a tile renders. alert and warn collapse to warning; alarm and emergency to
// alarm; normal, nominal, unknown states, and no zones are normal (per spec, any part of the range
// not explicitly within a zone is normal).
export type ZoneState = 'normal' | 'warning' | 'alarm';

export interface MetaZone {
  lower?: number;
  upper?: number;
  state: string;
  message?: string;
}

export interface PathMeta {
  zones?: MetaZone[];
  units?: string;
  displayName?: string;
  // The path's declared staleness window in SECONDS (the server's meta.timeout): 0 means never
  // stale, 'auto' means the server derives it per source. Only an explicit declaration is carried;
  // the server's derived and default windows stay server-internal.
  timeout?: number | 'auto';
}

const STATE_RANK: Record<ZoneState, number> = { normal: 0, warning: 1, alarm: 2 };

// A declared meta.timeout as a client staleness window in ms: 0 means never stale (Infinity),
// 'auto' and absent mean the caller keeps its client default (the server's derived and default
// windows are server-internal, so honoring them here would misstate what the server declared).
export function staleWindowMsFromTimeout(timeout: PathMeta['timeout']): number | undefined {
  if (timeout === undefined || timeout === 'auto') return undefined;
  return timeout === 0 ? Number.POSITIVE_INFINITY : timeout * 1000;
}

// Bounds must be finite numbers or absent: a string or NaN bound silently mis-bands every value it
// is compared against, so a malformed zone is dropped rather than carried into the banding.
function isMetaZone(value: unknown): value is MetaZone {
  return (
    isRecord(value) &&
    typeof value.state === 'string' &&
    (value.lower === undefined || isFiniteNumber(value.lower)) &&
    (value.upper === undefined || isFiniteNumber(value.upper)) &&
    (value.message === undefined || typeof value.message === 'string')
  );
}

function displayState(state: string): ZoneState {
  if (state === 'alarm' || state === 'emergency') return 'alarm';
  if (state === 'warn' || state === 'alert') return 'warning';
  return 'normal';
}

// Band an SI value against SI zone bounds (run BEFORE display conversion). Overlapping zones
// resolve to the worst matching band, so a nested alarm inside a warn range still alarms.
export function zoneStateFor(
  value: number | undefined,
  zones: readonly MetaZone[] | undefined,
): ZoneState {
  if (value === undefined || !zones || zones.length === 0) return 'normal';
  let worst: ZoneState = 'normal';
  for (const zone of zones) {
    // Zones are right-open [lower, upper): a value equal to upper belongs to the next zone up,
    // so adjacent zones partition the range without double-matching the shared boundary.
    if (zone.lower !== undefined && value < zone.lower) continue;
    if (zone.upper !== undefined && value >= zone.upper) continue;
    const state = displayState(zone.state);
    if (STATE_RANK[state] > STATE_RANK[worst]) worst = state;
  }
  return worst;
}

// Per-path metadata over v1 REST. Meta is REST-only by design: the worker drops update.meta deltas.
// Any failure (401, 404, malformed body) resolves undefined so a tile silently stays neutral; the
// caller caches per path per origin, since zones are near-static.
export async function fetchPathMeta(
  base: string,
  token: string | undefined,
  path: string,
): Promise<PathMeta | undefined> {
  const url = `${base}/signalk/v1/api/vessels/self/${path.replaceAll('.', '/')}/meta`;
  const body = await fetchAuthedJson<unknown>(url, token);
  if (!isRecord(body)) return undefined;
  const zones = Array.isArray(body.zones) ? body.zones.filter(isMetaZone) : undefined;
  const timeout =
    body.timeout === 'auto' || (isFiniteNumber(body.timeout) && body.timeout >= 0)
      ? body.timeout
      : undefined;
  return {
    zones,
    units: typeof body.units === 'string' ? body.units : undefined,
    displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
    timeout,
  };
}
