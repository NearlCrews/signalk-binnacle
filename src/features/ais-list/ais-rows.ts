import { type AisTargetView, vesselLabel } from '$entities/ais';
import type { DangerContact, Severity } from '$entities/collision';
import type { LatLon } from '$shared/geo';
import { compareOptionalNumber } from '$shared/lib';
import { haversineMeters, rhumbBearingRad } from '$shared/nav';

export type AisSort = 'range' | 'cpa' | 'name';

export interface AisListRow {
  id: string;
  // The display name: the vessel's reported name, or its MMSI from the context id.
  label: string;
  position: LatLon;
  rangeMeters?: number;
  bearingRad?: number;
  sogMps?: number;
  headingRad?: number;
  cpaMeters?: number;
  tcpaSeconds?: number;
  // Signal K's navigation.state enum (underway, anchored, moored, and similar); undefined when the
  // target has never reported it.
  navigationState?: string;
  // The lookout's grading for this contact, when it considers it a risk.
  severity?: Severity;
}

export function buildAisRows(
  targets: readonly AisTargetView[],
  own: LatLon | undefined,
  contacts: readonly DangerContact[],
  sort: AisSort,
): AisListRow[] {
  // The lookout's contact per target id, so a risky target reads in its severity color here, and
  // its locally computed CPA and TCPA fill in when the provider publishes none.
  const risks = new Map<string, DangerContact>();
  for (const contact of contacts) risks.set(contact.id, contact);
  const rows = targets.map<AisListRow>((target) => {
    const risk = risks.get(target.id);
    return {
      id: target.id,
      label: vesselLabel(target.name, target.id),
      position: target.position,
      rangeMeters: own
        ? haversineMeters(
            own.latitude,
            own.longitude,
            target.position.latitude,
            target.position.longitude,
          )
        : undefined,
      bearingRad: own ? rhumbBearingRad(own, target.position) : undefined,
      sogMps: target.sogMps,
      headingRad: target.headingRad,
      cpaMeters: target.cpaMeters ?? risk?.cpaMeters,
      tcpaSeconds: target.tcpaSeconds ?? risk?.tcpaSeconds,
      navigationState: target.navigationState,
      severity: risk?.severity,
    };
  });
  if (sort === 'name') rows.sort((a, b) => a.label.localeCompare(b.label));
  else if (sort === 'cpa') rows.sort((a, b) => compareOptionalNumber(a.cpaMeters, b.cpaMeters));
  else rows.sort((a, b) => compareOptionalNumber(a.rangeMeters, b.rangeMeters));
  return rows;
}
