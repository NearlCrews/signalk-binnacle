import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  type GeoJSONStoreFeatures,
  type SnapToCustom,
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawSelectMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { Route, RouteWaypoint } from '$entities/route';
import { isLonLat, type LatLon, latLonToLonLat, lonLatToLatLon, roundLatLon } from '$shared/geo';
import { mapThemePaint } from '$shared/map';
import type { Theme } from '$shared/ui';
import { nearestSnapPosition, type SnapTarget } from './route-snap';

// Terra Draw tags every feature with its mode in properties.mode; the on-chart route is a
// single linestring drawn or edited in that mode. These names are Terra Draw's registered mode
// ids, so they must match the modes constructed below.
const LINESTRING_MODE = 'linestring';
const POINT_MODE = 'point';
const SELECT_MODE = 'select';

// The on-chart editing line uses the theme's bright selection accent so it reads vividly against
// blue water and the chart instead of blending in. It reads the one source (the map-theme select,
// which the --select CSS token mirrors) rather than a second copy, so the two can never drift. The
// cast is safe because every theme's select is a hex color.
function drawColor(theme: Theme): `#${string}` {
  return mapThemePaint(theme).select as `#${string}`;
}

export function drawFeatureToWaypoints(feature: GeoJSON.Feature): RouteWaypoint[] {
  const geom = feature.geometry;
  if (geom.type !== 'LineString') return [];
  return geom.coordinates.filter(isLonLat).map((c) => ({ position: lonLatToLatLon(c) }));
}

// Terra Draw rounds coordinates to its store precision, so an untouched point can come back
// perturbed below the millimeter scale; the tolerance absorbs that while still treating any real
// drag as a different position.
const COORD_MATCH_EPSILON_DEG = 1e-9;

// Terra Draw's default store precision: addFeatures rejects any feature whose coordinates carry more
// than this many decimal places, dropping the whole route silently. A saved route already carries
// Terra-Draw-rounded coordinates, but any seeded route with full-precision doubles needs rounding
// or the chart would show nothing. Nine decimals shifts a point by at most ~5e-10 degrees, under
// COORD_MATCH_EPSILON_DEG, so name reconciliation is unaffected.
const DRAW_COORD_DECIMALS = 9;

function positionsMatch(a: LatLon, b: LatLon): boolean {
  return (
    Math.abs(a.latitude - b.latitude) <= COORD_MATCH_EPSILON_DEG &&
    Math.abs(a.longitude - b.longitude) <= COORD_MATCH_EPSILON_DEG
  );
}

// The single waypoints-to-LineString mapper, in the narrower store-feature shape (non-null
// Record<string, JSON> properties) that Terra Draw's addFeatures wants.
export function routeToStoreFeature(route: Route): GeoJSONStoreFeatures<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: { mode: LINESTRING_MODE },
    geometry: {
      type: 'LineString',
      coordinates: route.waypoints.map((w) =>
        latLonToLonLat(roundLatLon(w.position, DRAW_COORD_DECIMALS)),
      ),
    },
  };
}

export interface RouteEditor {
  start(route?: Route, initialPoint?: LatLon): void;
  setTheme(theme: Theme): void;
  stop(): void;
}

export function createRouteEditor(opts: {
  map: MapLibreMap;
  beforeId?: string;
  theme: Theme;
  // Saved-waypoint positions a placed or dragged vertex snaps to, read per event so the latest
  // collection applies; absent disables snapping.
  snapTargets?: () => readonly SnapTarget[];
  onChange: (waypoints: RouteWaypoint[]) => void;
}): RouteEditor {
  const color = drawColor(opts.theme);
  // Snapping rides Terra Draw's toCustom hook, the one snapping mechanism that reaches outside the
  // draw store (toCoordinate and toLine only snap to other drawn features) and the only one both
  // the drawing mode and select-mode vertex drags share, so placing and dragging behave alike
  // without fighting the drag. The returned position is rounded to the store precision Terra Draw
  // enforces (see DRAW_COORD_DECIMALS); at nine decimals the vertex sits within a tenth of a
  // millimeter of the waypoint, and matches how a seeded route already stores it.
  const snapTargets = opts.snapTargets;
  const toCustom: SnapToCustom | undefined =
    snapTargets &&
    ((event, context) => {
      const snapped = nearestSnapPosition(
        { x: event.containerX, y: event.containerY },
        snapTargets(),
        context,
      );
      return snapped && latLonToLonLat(roundLatLon(snapped, DRAW_COORD_DECIMALS));
    });
  const snapping = toCustom && { toCustom };
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({
      map: opts.map,
      prefixId: 'binnacle-route-draw',
      renderBelowLayerId: opts.beforeId,
    }),
    modes: [
      new TerraDrawPointMode({ styles: { pointColor: color, pointWidth: 6 } }),
      new TerraDrawLineStringMode({
        // The snapping guidance point Terra Draw renders while hovering a snap target takes the
        // theme color too, so night-red never shows the library's default point colors.
        styles: {
          lineStringColor: color,
          lineStringWidth: 4,
          snappingPointColor: color,
          snappingPointOutlineColor: color,
        },
        snapping,
      }),
      new TerraDrawSelectMode({
        styles: {
          selectionPointColor: color,
          midPointColor: color,
        },
        flags: {
          linestring: {
            feature: {
              draggable: true,
              coordinates: {
                midpoints: true,
                draggable: true,
                deletable: true,
                snappable: snapping,
              },
            },
          },
        },
      }),
    ],
  });

  // The last emitted waypoints, seeded from start's route, so a rebuild from Terra Draw
  // coordinates can put the per-waypoint names back on the points that did not move. Terra Draw
  // only carries coordinates, so without this every edit would discard all names and the save
  // would drop coordinatesMeta. anyNamed is kept beside it so the per-pointermove change events
  // of an unnamed route (the common case) skip the O(rebuilt x remembered) scan entirely.
  let remembered: RouteWaypoint[] = [];
  let anyNamed = false;
  const remember = (waypoints: RouteWaypoint[]): void => {
    remembered = waypoints;
    anyNamed = waypoints.some((w) => w.name != null);
  };

  // While a fresh route is being drawn, Terra Draw keeps a trailing "ghost" coordinate on the line
  // that follows the cursor until the next tap commits it, so the in-progress line always carries
  // one coordinate more than the points the navigator has actually placed. We drop that ghost from
  // the emitted waypoints so the panel count, the save gate, and a saved route reflect placed points,
  // not the cursor. When editing a saved route in select mode every coordinate is real, so nothing
  // is dropped. The finish event (double-tap or Enter completes the line and removes the ghost)
  // clears the flag so the completed line's coordinates are then all kept.
  let drawing = false;

  // Re-attach names: a rebuilt coordinate that equals a remembered waypoint's position keeps that
  // waypoint's name, consuming remembered entries in order so a route that visits the same point
  // twice keeps both names in sequence. A dragged point matches nothing and loses its name, which
  // is the honest outcome: the named mark no longer sits there.
  // Reused across change events: a drag fires one change per pointermove, so allocating a fresh
  // consumed array each call would churn proportional to the named-route length on every pixel.
  // Assumes single-threaded, non-re-entrant calls (safe in JS; do not make onChange async).
  const nameConsumed: boolean[] = [];
  const reconcileNames = (rebuilt: RouteWaypoint[]): RouteWaypoint[] => {
    if (!anyNamed) return rebuilt;
    nameConsumed.length = remembered.length;
    nameConsumed.fill(false);
    return rebuilt.map((waypoint) => {
      for (let i = 0; i < remembered.length; i += 1) {
        if (nameConsumed[i] || !positionsMatch(remembered[i].position, waypoint.position)) continue;
        nameConsumed[i] = true;
        const name = remembered[i].name;
        return name == null ? waypoint : { ...waypoint, name };
      }
      return waypoint;
    });
  };

  // The route linestrings in the store. Terra Draw stamps its auxiliary cursor and closing-point
  // features with the SAME properties.mode as the line, so the geometry type is checked too: a Point
  // carrying mode 'linestring' is the cursor point, not the route, and reading it as the working line
  // would emit zero waypoints and make the drawn line vanish. Matching on mode alone is the bug.
  const linestrings = (): GeoJSONStoreFeatures[] =>
    draw
      .getSnapshot()
      .filter((f) => f.properties.mode === LINESTRING_MODE && f.geometry.type === 'LineString');

  // The change handler must never mutate the Terra Draw store synchronously. Terra Draw commits a
  // tapped coordinate by firing a change event from inside its own update, and removing a feature
  // during that window clears Terra Draw's in-progress drawing id, so its next history snapshot
  // throws "No feature with this id (undefined), can not get geometry copy" and route drawing dies.
  // So read() selects the working line synchronously for the panel, and the stale extras are dropped
  // in a microtask, after Terra Draw has finished its commit. pruning suppresses the nested change
  // the removal fires; prunePending coalesces repeated schedules into one. The microtask queue drains
  // between two taps, so the next tap sees one line.
  let pruning = false;
  let prunePending = false;
  let started = false;

  // Terra Draw appends features in creation order, so the line being drawn or edited is the last
  // entry; any earlier linestrings are stale extras left when one line was finished and a new one
  // started, and those get pruned.
  const workingLine = (
    lines: GeoJSONStoreFeatures[],
  ): { line: GeoJSONStoreFeatures; extraIds: Array<string | number> } => {
    const line = lines[lines.length - 1];
    const extraIds = lines
      .slice(0, -1)
      .map((f) => f.id)
      .filter((id): id is string | number => id != null);
    return { line, extraIds };
  };

  const prune = (): void => {
    prunePending = false;
    if (!started) return;
    const lines = linestrings();
    if (lines.length <= 1) return;
    const { extraIds } = workingLine(lines);
    if (extraIds.length === 0) return;
    pruning = true;
    try {
      draw.removeFeatures(extraIds);
    } finally {
      pruning = false;
    }
  };

  const read = (): RouteWaypoint[] => {
    const lines = linestrings();
    if (lines.length === 0) return [];
    const { line, extraIds } = workingLine(lines);
    if (extraIds.length > 0 && !prunePending) {
      prunePending = true;
      queueMicrotask(prune);
    }
    const placed = drawFeatureToWaypoints(line);
    // Drop the trailing cursor ghost while drawing a fresh route (see `drawing` above).
    const waypoints = drawing ? placed.slice(0, -1) : placed;
    return reconcileNames(waypoints);
  };

  const onRouteChange = (_ids: unknown, type: string) => {
    if (pruning) return;
    // Styling changes come from setTheme's updateModeOptions, not a geometry edit, so they must not
    // re-run the change pipeline.
    if (type === 'styling') return;
    const next = read();
    remember(next);
    opts.onChange(next);
  };
  draw.on('change', onRouteChange);

  // Completing a line (double-tap or Enter) removes Terra Draw's trailing ghost, so stop dropping a
  // coordinate; the finished line's coordinates are then all placed points.
  const onRouteFinish = () => {
    drawing = false;
    const next = read();
    remember(next);
    opts.onChange(next);
  };
  draw.on('finish', onRouteFinish);

  // "Start a route here" seeds the first waypoint at a chosen spot. Terra Draw has no API to seed an
  // in-progress line, so replay the exact path a real opening tap takes: dispatch a pointer down and
  // up at the point's screen pixel on the map canvas, which Terra Draw's adapter reads as the first
  // click. Deferred a microtask so linestring mode's listeners are attached first.
  const placeFirstPoint = (point: LatLon): void => {
    queueMicrotask(() => {
      if (!started) return;
      const canvas = opts.map.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const { x, y } = opts.map.project([point.longitude, point.latitude]);
      const event = {
        clientX: rect.left + x,
        clientY: rect.top + y,
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
      } as const;
      // pointerdown must carry buttons:1 (primary held); pointerup carries buttons:0 (released).
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...event, buttons: 1 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { ...event, buttons: 0 }));
    });
  };

  return {
    start(route, initialPoint) {
      remember(route ? route.waypoints.slice() : []);
      draw.start();
      started = true;
      if (route && route.waypoints.length > 0) {
        drawing = false;
        const validations = draw.addFeatures([routeToStoreFeature(route)]);
        // A seed that fails Terra Draw's coordinate-precision validation is dropped silently and the
        // editor would open blank; surface it so a rejected seed is observable rather than invisible.
        const rejected = validations.filter((v) => !v.valid);
        if (rejected.length > 0) console.warn('Route seed rejected by Terra Draw', rejected);
        draw.setMode(SELECT_MODE);
      } else {
        drawing = true;
        draw.setMode(LINESTRING_MODE);
        if (initialPoint) placeFirstPoint(initialPoint);
      }
    },
    setTheme(theme) {
      const color = drawColor(theme);
      draw.updateModeOptions(POINT_MODE, { styles: { pointColor: color, pointWidth: 6 } });
      draw.updateModeOptions(LINESTRING_MODE, {
        styles: {
          lineStringColor: color,
          lineStringWidth: 4,
          snappingPointColor: color,
          snappingPointOutlineColor: color,
        },
      });
      draw.updateModeOptions(SELECT_MODE, {
        styles: { selectionPointColor: color, midPointColor: color },
      });
    },
    stop() {
      // Guarded so a stop on unmount when editing never started (or already stopped) is a no-op
      // rather than a Terra Draw "not started" throw.
      if (!started) return;
      started = false;
      drawing = false;
      prunePending = false;
      // onRouteChange and onRouteFinish are registered once at construction, not per start(), and
      // this editor instance is reused across every edit session (ChartCanvas memoizes it, so
      // start()/stop() cycle on the same instance): draw.stop() does not remove listeners, and
      // off()'ing them here with no matching re-registration in start() would silently break every
      // edit session after the first.
      draw.stop();
    },
  };
}
