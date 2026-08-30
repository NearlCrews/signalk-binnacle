import type { CollisionContact } from '$entities/collision';
import type { LatLon } from '$shared/geo';
import { isFiniteNumber, isRecord, readBoundedJson, withTimeout } from '$shared/lib';
import { authInit } from '$shared/signalk';
import { RADARS_PATH } from './radar-client';
import {
  MAX_RADAR_DISTANCE_METERS,
  MAX_RADAR_JSON_BYTES,
  MAX_RADAR_TARGET_SPEED_MPS,
  MAX_RADAR_TARGET_TCPA_SECONDS,
  MAX_RADAR_TARGETS,
} from './radar-limits';
import type { RadarTarget } from './radar-types';

// The outcome of a provider-gated targets read. 'unsupported' is the dormant no-ARPA signal,
// distinct from 'error' so the controller can stop polling a radar that will never answer instead
// of retrying it every cadence.
export type RadarTargetsOutcome =
  | { kind: 'ok'; targets: RadarTarget[] }
  | { kind: 'unsupported' }
  | { kind: 'error' };

// The statuses that mean the endpoint will never serve targets for this radar: the Signal K server
// answers 501 for a provider without getTargets and 404 for an unknown radar or an older server
// without the route, Mayara answers 400 when its tracker is not enabled (--targets arpa), and 405
// covers a route that exists without GET. Everything else non-ok is a transient error.
const UNSUPPORTED_STATUSES: ReadonlySet<number> = new Set([400, 404, 405, 501]);

const TRACKED_STATUSES: ReadonlySet<string> = new Set(['tracking', 'acquiring']);
const TAU = 2 * Math.PI;

function targetPosition(raw: unknown): LatLon | undefined {
  if (!isRecord(raw)) return undefined;
  const { latitude, longitude } = raw;
  return isFiniteNumber(latitude) &&
    Math.abs(latitude) <= 90 &&
    isFiniteNumber(longitude) &&
    Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : undefined;
}

// One wire target to the parsed shape, or undefined to drop it. 'lost' targets are dropped: their
// track is stale by definition and must not keep grading in the collision assessment. A target
// without latitude and longitude is dropped too, since a provider without own-ship navigation data
// serves only bearing and distance, and an ungeoreferenced contact can neither be assessed nor
// even listed with a position.
export function toRadarTarget(raw: unknown): RadarTarget | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.status !== 'string' || !TRACKED_STATUSES.has(raw.status)) return undefined;
  const id = raw.id;
  if (!isFiniteNumber(id) || !Number.isSafeInteger(id) || id < 0) return undefined;
  const position = targetPosition(raw.position);
  if (!position) return undefined;
  const target: RadarTarget = { id, status: raw.status as RadarTarget['status'], position };
  // Course and speed stand or fall together: either alone cannot feed the computed CPA branch, so
  // a malformed pair drops the motion and the target grades unassessed rather than vanishing. The
  // course bound accepts both the spec's [0, 2pi) and a signed [-pi, pi] provider convention.
  const motion = raw.motion;
  if (
    isRecord(motion) &&
    isFiniteNumber(motion.speed) &&
    motion.speed >= 0 &&
    motion.speed <= MAX_RADAR_TARGET_SPEED_MPS &&
    isFiniteNumber(motion.course) &&
    Math.abs(motion.course) <= TAU
  ) {
    target.speedMps = motion.speed;
    target.courseRad = motion.course;
  }
  // cpa and tcpa are one provider assessment: a bounded pair or nothing, mirroring the motion rule.
  // A negative tcpa is valid (the approach has passed) and drives the receding hold downstream.
  const danger = raw.danger;
  if (
    isRecord(danger) &&
    isFiniteNumber(danger.cpa) &&
    danger.cpa >= 0 &&
    danger.cpa <= MAX_RADAR_DISTANCE_METERS &&
    isFiniteNumber(danger.tcpa) &&
    Math.abs(danger.tcpa) <= MAX_RADAR_TARGET_TCPA_SECONDS
  ) {
    target.cpaMeters = danger.cpa;
    target.tcpaSeconds = danger.tcpa;
  }
  return target;
}

// The tracked ARPA and MARPA targets for one radar, from the standard Radar API targets endpoint.
// Malformed elements are dropped individually; a response that is not a bounded array is an error
// outcome, never a silent empty list.
export async function fetchRadarTargets(
  origin: string,
  token: string | undefined,
  radarId: string,
): Promise<RadarTargetsOutcome> {
  try {
    const url = `${origin}${RADARS_PATH}/${encodeURIComponent(radarId)}/targets`;
    const response = await fetch(url, withTimeout(authInit(token)));
    if (!response.ok) {
      return UNSUPPORTED_STATUSES.has(response.status)
        ? { kind: 'unsupported' }
        : { kind: 'error' };
    }
    const body = await readBoundedJson<unknown>(response, MAX_RADAR_JSON_BYTES);
    if (!Array.isArray(body) || body.length > MAX_RADAR_TARGETS) return { kind: 'error' };
    const targets: RadarTarget[] = [];
    for (const raw of body) {
      const target = toRadarTarget(raw);
      if (target) targets.push(target);
    }
    return { kind: 'ok', targets };
  } catch {
    return { kind: 'error' };
  }
}

// Radar targets in the collision entity's own contact shape. The 'radar:' id namespace can never
// collide with an AIS context id, and the name is what the danger strip renders, so a contact
// reads "Radar 7" rather than an id blob. Provider cpa and tcpa pass through and grade exactly
// like navigation.closestApproach; a target carrying motion without them goes through the
// computed branch, and one without motion lands unassessed.
export function toCollisionContacts(radarId: string, targets: RadarTarget[]): CollisionContact[] {
  return targets.map((target) => ({
    id: `radar:${radarId}:${target.id}`,
    name: `Radar ${target.id}`,
    position: target.position,
    sogMps: target.speedMps,
    cogRad: target.courseRad,
    cpaMeters: target.cpaMeters,
    tcpaSeconds: target.tcpaSeconds,
  }));
}
