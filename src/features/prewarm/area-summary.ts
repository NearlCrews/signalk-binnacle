import type { LngLatBbox } from 'signalk-chart-sources';
import { formatNm } from '$shared/lib';
import { haversineMeters } from '$shared/nav';
import { DETAIL_PRESETS, presetForRange } from './detail-level';

// The compact facts an offline-area card shows without opening its disclosure, so several areas can
// be told apart at a glance: plain-language detail, chart count with any unavailable ones, and the
// approximate coverage span. Completion and recency stay on the card's own status and Updated
// fields; none of this claims the area is passage-ready.

// The east-west span is measured at the box's center latitude, where a mid-latitude area's
// longitude degrees are narrower than at the equator, so the label matches what a navigator would
// measure across the middle of the box.
export function bboxSpanText([west, south, east, north]: LngLatBbox): string | undefined {
  if (![west, south, east, north].every(Number.isFinite)) return undefined;
  if (north <= south) return undefined;
  const eastUnwrapped = east <= west ? east + 360 : east;
  const midLat = (south + north) / 2;
  const widthM = haversineMeters(midLat, 0, midLat, Math.min(eastUnwrapped - west, 180));
  const heightM = haversineMeters(south, 0, north, 0);
  if (widthM <= 0 || heightM <= 0) return undefined;
  const nm = (meters: number) => Math.max(1, Number(formatNm(meters, 0)));
  return `about ${nm(widthM)} by ${nm(heightM)} nm`;
}

export function detailLabel(minzoom: number, maxzoom: number): string {
  const key = presetForRange(minzoom, maxzoom);
  if (key === 'custom') return 'Custom detail';
  const preset = DETAIL_PRESETS.find((p) => p.key === key);
  return `${preset?.label ?? 'Custom'} detail`;
}

export function chartCountText(sourceIds: readonly string[], unavailable: number): string {
  const count = `${sourceIds.length} chart${sourceIds.length === 1 ? '' : 's'}`;
  return unavailable > 0 ? `${count}, ${unavailable} unavailable` : count;
}

export function areaSummary(region: {
  bbox: LngLatBbox;
  minzoom: number;
  maxzoom: number;
  sourceIds: readonly string[];
  unavailableSourceIds: readonly string[];
}): string {
  const parts = [
    detailLabel(region.minzoom, region.maxzoom),
    chartCountText(region.sourceIds, region.unavailableSourceIds.length),
  ];
  const span = bboxSpanText(region.bbox);
  if (span) parts.push(span);
  return parts.join(' · ');
}
