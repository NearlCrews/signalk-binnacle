import { type AisTargetView, shortVesselId, vesselLabel } from '$entities/ais';
import type { DangerContact, Severity } from '$entities/collision';
import type { LatLon } from '$shared/geo';
import { compareOptionalNumber } from '$shared/lib';
import { haversineMeters, rhumbBearingRad } from '$shared/nav';

export type AisSort = 'range' | 'cpa' | 'name';
export type AisRiskFilter = 'all' | 'danger' | 'warning';
export const MAX_AIS_LIST_ROWS = 500;
// How often the list re-reads traffic. The overlays use the same floor (ais-layer's refresh gate):
// a rendered position does not need better than about 1 Hz, and a glanceable list needs it less.
export const AIS_LIST_REFRESH_MS = 1_000;

export interface AisListRow {
  id: string;
  identifier: string;
  // The display name: the vessel's reported name, or its MMSI from the context id.
  label: string;
  position: LatLon;
  rangeMeters?: number;
  bearingRad?: number;
  sogMps?: number;
  cogRad?: number;
  headingRad?: number;
  shipTypeId?: number;
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
  query = '',
  riskFilter: AisRiskFilter = 'all',
): AisListRow[] {
  // The lookout's contact per target id, so a risky target reads in its severity color here, and
  // its locally computed CPA and TCPA fill in when the provider publishes none.
  const risks = new Map<string, DangerContact>();
  for (const contact of contacts) risks.set(contact.id, contact);
  let rows = targets.map<AisListRow>((target) => {
    const risk = risks.get(target.id);
    return {
      id: target.id,
      identifier: shortVesselId(target.id),
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
      cogRad: target.cogRad,
      headingRad: target.headingRad,
      shipTypeId: target.shipTypeId,
      cpaMeters: target.cpaMeters ?? risk?.cpaMeters,
      tcpaSeconds: target.tcpaSeconds ?? risk?.tcpaSeconds,
      navigationState: target.navigationState,
      severity: risk?.severity,
    };
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery) {
    rows = rows.filter((row) =>
      `${row.label}\n${row.identifier}\n${row.id}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }
  if (riskFilter !== 'all') {
    rows = rows.filter((row) => row.severity === riskFilter);
  }
  const byIdentity = (a: AisListRow, b: AisListRow): number =>
    a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  if (sort === 'name') rows.sort(byIdentity);
  else if (sort === 'cpa') {
    rows.sort((a, b) => compareOptionalNumber(a.cpaMeters, b.cpaMeters) || byIdentity(a, b));
  } else {
    rows.sort((a, b) => compareOptionalNumber(a.rangeMeters, b.rangeMeters) || byIdentity(a, b));
  }
  return rows;
}
