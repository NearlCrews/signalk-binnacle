import { ANCHOR_OVERLAY_ID } from '$features/anchor-watch';
import { COLLISION_OVERLAY_ID } from '$features/lookout';
import { MOB_OVERLAY_ID } from '$features/mob';
import { COURSE_OVERLAY_ID, ROUTE_OVERLAY_ID } from '$features/route-layer';
import { OWN_VESSEL_OVERLAY_ID } from '$features/vessel-layer';

// The overlays a navigator cannot safely sail without, mapped to the helm copy the failure notice
// uses. One record feeds both the widget's failure detection (the keys) and the view's message
// (the values), so an overlay cannot join one side without the other: a raw internal id can never
// reach a safety notice, and an orphaned label can never sit dead.
export const CRITICAL_OVERLAY_LABELS: Readonly<Record<string, string>> = {
  [OWN_VESSEL_OVERLAY_ID]: 'vessel position',
  [COLLISION_OVERLAY_ID]: 'collision warnings',
  [MOB_OVERLAY_ID]: 'man-overboard marker',
  [ANCHOR_OVERLAY_ID]: 'anchor watch',
  [COURSE_OVERLAY_ID]: 'active course',
  [ROUTE_OVERLAY_ID]: 'routes',
};

export const CRITICAL_OVERLAY_IDS: readonly string[] = Object.keys(CRITICAL_OVERLAY_LABELS);
