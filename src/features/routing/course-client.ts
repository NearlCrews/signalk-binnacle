import type { LatLon } from '$shared/geo';
import { fetchJsonOrUndefined } from '$shared/lib';
import type { CourseCalculations, CourseInfo } from '$shared/signalk';
import { authInit, deleteResource, putResource } from '$shared/signalk';

const COURSE = '/signalk/v2/api/vessels/self/navigation/course';

export function activateRoute(
  base: string,
  token: string | undefined,
  href: string,
  pointIndex = 0,
  reverse = false,
): Promise<boolean> {
  return putResource(`${base}${COURSE}/activeRoute`, token, { href, pointIndex, reverse });
}

// A single-point course target: a bare position, or the href of a saved waypoint resource. The
// optional never members make the two forms mutually exclusive, so a caller cannot build a body
// carrying both and leave it to the server to decide which one wins.
export type DestinationTarget =
  | { position: LatLon; href?: never }
  | { href: string; position?: never };

// Set a single-point destination ("go to here"): the v2 Course API replaces any active route with a
// course straight to this target. The body is the target alone, never both forms: given an href the
// server resolves the waypoint itself and publishes its name and href on nextPoint, which is what
// lets the navigation strip name the destination instead of showing a placeholder.
export function setDestination(
  base: string,
  token: string | undefined,
  target: DestinationTarget,
): Promise<boolean> {
  return putResource(`${base}${COURSE}/destination`, token, target);
}

export function advancePoint(
  base: string,
  token: string | undefined,
  value: number,
): Promise<boolean> {
  if (!Number.isInteger(value) || value === 0) return Promise.resolve(false);
  return putResource(`${base}${COURSE}/activeRoute/nextPoint`, token, { value });
}

// Set the active route's absolute point index. Unlike nextPoint's signed relative increment,
// repeating this request is idempotent, so a delayed local arrival reaction cannot skip a second
// waypoint after another station already advanced the course.
export function setActiveRoutePointIndex(
  base: string,
  token: string | undefined,
  activeRoute: { href?: string; pointTotal?: number; reverse?: boolean },
  pointIndex: number,
): Promise<boolean> {
  const href = activeRoute.href;
  const total = activeRoute.pointTotal;
  if (
    typeof href !== 'string' ||
    !href.trim() ||
    !Number.isInteger(pointIndex) ||
    pointIndex < 0 ||
    (Number.isInteger(total) && total !== undefined && pointIndex >= total)
  ) {
    return Promise.resolve(false);
  }
  return putResource(`${base}${COURSE}/activeRoute/pointIndex`, token, { value: pointIndex });
}

export function refreshActiveRoute(base: string, token: string | undefined): Promise<boolean> {
  return putResource(`${base}${COURSE}/activeRoute/refresh`, token, {});
}

// Set the boat-wide arrival radius. The server accepts any non-negative number and every station's
// arrival latch reads it back off the stream, which is what lets the helm and a tablet below agree.
export function setArrivalCircle(
  base: string,
  token: string | undefined,
  meters: number,
): Promise<boolean> {
  if (!Number.isFinite(meters) || meters < 0) return Promise.resolve(false);
  return putResource(`${base}${COURSE}/arrivalCircle`, token, { value: meters });
}

// Restart the active leg from the boat's position: the server moves previousPoint to the current
// fix, zeroing cross-track error. Rejected (400) without an active destination or a position fix.
export function restartCourse(base: string, token: string | undefined): Promise<boolean> {
  return putResource(`${base}${COURSE}/restart`, token, {});
}

// Set or clear (null) the boat-wide planned arrival instant. Takes a Date rather than an ISO string
// because the server's validator only accepts the UTC "Z" form or a negative numeric offset, so a
// caller's local "+02:00" ISO string would be refused; sending toISOString sidesteps the trap.
export function setTargetArrivalTime(
  base: string,
  token: string | undefined,
  when: Date | null,
): Promise<boolean> {
  if (when !== null && !Number.isFinite(when.getTime())) return Promise.resolve(false);
  return putResource(`${base}${COURSE}/targetArrivalTime`, token, {
    value: when === null ? null : when.toISOString(),
  });
}

export function clearCourse(base: string, token: string | undefined): Promise<boolean> {
  return deleteResource(`${base}${COURSE}`, token);
}

// What a hydrated course snapshot says about local activation: a route id when the server is
// navigating a saved route, a goto when it has a bare destination, or nothing when no course is
// active (or the snapshot is absent, so nothing is known). The href parse is the inverse of
// routes-client's routeHref.
export function activationFromCourse(
  info: CourseInfo | undefined,
): { routeId?: string; goto?: boolean } | undefined {
  if (!info) return undefined;
  const href = info.activeRoute?.href;
  const rawId = href?.match(/\/resources\/routes\/([^/?#]+)(?:[?#].*)?$/)?.[1];
  if (rawId) {
    try {
      return { routeId: decodeURIComponent(rawId) };
    } catch {
      return {};
    }
  }
  if (info.nextPoint?.position) return { goto: true };
  return {};
}

// One-time hydration: v2 course paths are not in the v1 full model, so the stream sends nothing
// until the next change. Read the current snapshot once when a course becomes active.
export async function hydrateCourse(
  base: string,
  token: string | undefined,
): Promise<{ info?: CourseInfo; calc?: CourseCalculations }> {
  const read = <T>(path: string): Promise<T | undefined> =>
    fetchJsonOrUndefined<T>(`${base}${COURSE}${path}`, authInit(token));
  const [info, calc] = await Promise.all([
    read<CourseInfo>(''),
    read<CourseCalculations>('/calcValues'),
  ]);
  return { info, calc };
}
