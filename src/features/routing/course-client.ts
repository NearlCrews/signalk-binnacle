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

// Set a single-point destination ("go to here"): the v2 Course API replaces any active route with a
// course straight to this position. Mirrors activateRoute but targets a position, not a route href.
export function setDestination(
  base: string,
  token: string | undefined,
  position: LatLon,
): Promise<boolean> {
  return putResource(`${base}${COURSE}/destination`, token, { position });
}

export function advancePoint(
  base: string,
  token: string | undefined,
  value: number,
): Promise<boolean> {
  if (!Number.isInteger(value) || value === 0) return Promise.resolve(false);
  return putResource(`${base}${COURSE}/activeRoute/nextPoint`, token, { value });
}

export function refreshActiveRoute(base: string, token: string | undefined): Promise<boolean> {
  return putResource(`${base}${COURSE}/activeRoute/refresh`, token, {});
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
