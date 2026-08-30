import type { GeoJSONFeatureDiff, GeoJSONSourceDiff } from 'maplibre-gl';
import type { AisTargetView } from '$entities/ais';
import { latLonToLonLat } from '$shared/geo';
import { headingDegrees } from '$shared/lib';
import { AIS_ICON_ID, ATON_ICON_ID, ATON_VIRTUAL_ICON_ID, SAR_ICON_ID } from './ais-icon';

// The feature property carrying a target's severity rank. A layout property (symbol-sort-key) and
// the label filter read it, and neither can read feature-state, so grading rides the data path and
// ships through the same diff as any other property change.
export const AIS_SEVERITY_RANK_PROP = 'severityRank';

// Which registered image a target renders with: the triangle for vessels, a diamond for a
// navigation aid (hollow when the aid is virtual), and a cross for a SAR aircraft.
export function iconIdFor(target: AisTargetView): string {
  if (target.kind === 'aton') return target.virtual ? ATON_VIRTUAL_ICON_ID : ATON_ICON_ID;
  if (target.kind === 'sar') return SAR_ICON_ID;
  return AIS_ICON_ID;
}

export function targetFeature(view: AisTargetView, rank: number): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: latLonToLonLat(view.position),
    },
    properties: {
      id: view.id,
      name: view.name ?? '',
      heading: headingDegrees(view.headingRad, view.cogRad),
      icon: iconIdFor(view),
      [AIS_SEVERITY_RANK_PROP]: rank,
    },
  };
}

// Only what the last painted feature rendered from; the derived fields (heading, icon, name) are
// recomputed from the retained view on compare, which is cheaper than holding a record of them.
interface PaintedTarget {
  view: AisTargetView;
  rank: number;
  tick: number;
}

export type AisSourceUpdate =
  | { kind: 'none' }
  | { kind: 'full'; features: GeoJSON.Feature[] }
  | { kind: 'diff'; diff: GeoJSONSourceDiff };

const NONE: AisSourceUpdate = { kind: 'none' };

// The sparse update entry for a target whose view or rank changed, or undefined when nothing the
// chart renders differs (a revision bump can carry only detail-panel fields like destination).
function featureUpdate(
  prev: AisTargetView,
  prevRank: number,
  next: AisTargetView,
  nextRank: number,
): GeoJSONFeatureDiff | undefined {
  const props: { key: string; value: unknown }[] = [];
  const nextName = next.name ?? '';
  if ((prev.name ?? '') !== nextName) props.push({ key: 'name', value: nextName });
  const nextHeading = headingDegrees(next.headingRad, next.cogRad);
  if (headingDegrees(prev.headingRad, prev.cogRad) !== nextHeading) {
    props.push({ key: 'heading', value: nextHeading });
  }
  const nextIcon = iconIdFor(next);
  if (iconIdFor(prev) !== nextIcon) props.push({ key: 'icon', value: nextIcon });
  if (prevRank !== nextRank) props.push({ key: AIS_SEVERITY_RANK_PROP, value: nextRank });
  const moved =
    prev.position.latitude !== next.position.latitude ||
    prev.position.longitude !== next.position.longitude;
  if (!moved && props.length === 0) return undefined;
  const diff: GeoJSONFeatureDiff = { id: next.id };
  if (moved) diff.newGeometry = { type: 'Point', coordinates: latLonToLonLat(next.position) };
  if (props.length > 0) diff.addOrUpdateProperties = props;
  return diff;
}

export interface AisSourceDiffer {
  // Diff the current target list against what was last shipped and say what to send: nothing, a
  // sparse GeoJSONSourceDiff, or a full feature set when more than half the list changed (the
  // first paint always lands here). The entity memoizes unchanged views, so an identity check per
  // target is the whole steady-state cost.
  next(views: readonly AisTargetView[], rankFor: (id: string) => number): AisSourceUpdate;
  // Forget the shipped state, so the next call repaints in full: the source was just (re)created
  // and holds nothing.
  reset(): void;
}

export function createAisSourceDiffer(): AisSourceDiffer {
  // Long-lived and mutated in place; entries are stamped with the pass number so removals fall out
  // of one sweep without a per-pass id set.
  const painted = new Map<string, PaintedTarget>();
  let tick = 0;

  return {
    next(views, rankFor) {
      tick += 1;
      // Fresh arrays on every pass rather than reused buffers: updateData holds its diff until the
      // worker acknowledges, and a queued diff merged with the next one still reads these arrays,
      // so mutating them across passes would corrupt an in-flight update.
      const adds: GeoJSON.Feature[] = [];
      const updates: GeoJSONFeatureDiff[] = [];
      const removes: string[] = [];
      for (const view of views) {
        const rank = rankFor(view.id);
        const prev = painted.get(view.id);
        if (!prev) {
          adds.push(targetFeature(view, rank));
          painted.set(view.id, { view, rank, tick });
          continue;
        }
        prev.tick = tick;
        if (prev.view === view && prev.rank === rank) continue;
        const update = featureUpdate(prev.view, prev.rank, view, rank);
        prev.view = view;
        prev.rank = rank;
        if (update) updates.push(update);
      }
      // Only a pruned target leaves an entry the loop above never visited.
      if (painted.size > views.length) {
        for (const [id, entry] of painted) {
          if (entry.tick === tick) continue;
          painted.delete(id);
          removes.push(id);
        }
      }
      const changed = adds.length + updates.length + removes.length;
      if (changed === 0) return NONE;
      if (changed * 2 > views.length) {
        return {
          kind: 'full',
          features: views.map((view) => targetFeature(view, rankFor(view.id))),
        };
      }
      const diff: GeoJSONSourceDiff = {};
      if (removes.length > 0) diff.remove = removes;
      if (adds.length > 0) diff.add = adds;
      if (updates.length > 0) diff.update = updates;
      return { kind: 'diff', diff };
    },
    reset() {
      painted.clear();
    },
  };
}
