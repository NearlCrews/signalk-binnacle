import { type MetaZone, putPathMetaZones, type ResourceMutationResult } from '$shared/signalk';

// The zone Binnacle publishes for a below-limit depth alarm. Danger for depth is BELOW the bound,
// so the zone is upper-bounded with no lower bound: zoneStateFor bands right-open [lower, upper),
// so this zone matches every depth under the limit and stops matching at exactly the limit. It
// round-trips through Binnacle's own reader as the same alarm: zoneStateFor reports 'alarm' under
// the limit, and the shallow monitor's alarmBound reads `upper` back as the server's bound.
export function shallowAlarmZones(limitMeters: number): MetaZone[] {
  return [{ upper: limitMeters, state: 'alarm', message: 'Shallow water' }];
}

export type ShallowPublishOutcome = 'published' | 'unsupported' | 'refused' | 'failed';

const OUTCOMES: Record<ResourceMutationResult, ShallowPublishOutcome> = {
  ok: 'published',
  'access-denied': 'refused',
  unavailable: 'unsupported',
  failed: 'failed',
};

// Write the shallow limit to the server as the depth path's alarm zone. Never throws. 'unsupported'
// is a server without the v1 meta write route, the detect-and-degrade arm the panel explains with
// the admin UI's manual path instead of pretending the publish landed.
export async function publishShallowZones(
  origin: string,
  token: string | undefined,
  path: string,
  limitMeters: number,
): Promise<ShallowPublishOutcome> {
  return OUTCOMES[await putPathMetaZones(origin, token, path, shallowAlarmZones(limitMeters))];
}
