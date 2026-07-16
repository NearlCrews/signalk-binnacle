// Detects the Chart Locker tile proxy. When the Chart Locker plugin is installed, the chartplotter
// fetches the remote raster overlays (and, later, the basemap) through the Signal K server so the boat
// shares one cache and works offline at sea. When it is absent, every source keeps its direct upstream
// URL, so a standalone install is unchanged.

import { proxyTileTemplate } from 'signalk-chart-sources';
import { withTimeout } from '$shared/lib';
import { adminSessionInit, authInit } from '$shared/signalk';

const COMPANION_PATH = '/plugins/signalk-chart-locker';

export type CompanionProbeResult =
  | { state: 'present'; base: string; ready: boolean }
  | { state: 'absent' }
  | { state: 'access-refused'; base: string }
  | { state: 'unreachable' };

/**
 * Probe Chart Locker without collapsing every failure into "not installed." A protected plugin route,
 * a missing route, and a broken network require different recovery steps in the menu.
 */
export async function probeCompanion(
  origin: string,
  token?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CompanionProbeResult> {
  const base = `${origin}${COMPANION_PATH}`;
  try {
    // Prefer the browser's administrator session so a device bearer cannot mask a valid cookie.
    // The readiness route is read-only, so a device token is a safe fallback when the server does
    // not expose the administrator session to the installed webapp. Management routes remain
    // session-only in their dedicated clients.
    let response = await fetchImpl(`${base}/tiles/ready`, withTimeout(adminSessionInit(), 2000));
    if ((response.status === 401 || response.status === 403) && token) {
      response = await fetchImpl(
        `${base}/tiles/ready`,
        withTimeout(
          authInit(token, { credentials: 'omit', cache: 'no-store', redirect: 'error' }),
          2000,
        ),
      );
    }
    if (response.ok) return { state: 'present', base, ready: true };
    if (response.status === 503) return { state: 'present', base, ready: false };
    if (response.status === 404) return { state: 'absent' };
    if (response.status === 401 || response.status === 403)
      return { state: 'access-refused', base };
    return { state: 'unreachable' };
  } catch {
    return { state: 'unreachable' };
  }
}

/**
 * Probe whether the companion tile proxy is installed. A 503 from this route means Chart Locker is
 * installed but its container is not ready, so it still proves presence. Try the browser administrator
 * session first because a device bearer token can mask a valid cookie, then fall back to the device
 * token for this read-only route. A 404 proves absence; 401 and 403 prove neither because Signal K can
 * reject requests before route matching.
 */
export async function detectCompanion(
  origin: string,
  token?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const result = await probeCompanion(origin, token, fetchImpl);
  return result.state === 'present' ? result.base : null;
}

/**
 * Route a list of sources through the companion proxy when present, else leave their
 * direct upstream URLs. The proxied template keys on the source id, which the companion expands to the
 * real upstream, so the webapp no longer builds WMS, WMTS, or ArcGIS requests on the proxied path.
 * Structural, not RasterOverlaySource-specific: the Seascape DEM and vector source descriptors
 * (features/depth-charts/seascape-sources.ts) are not raster WMS overlays but share the same id
 * and tiles[] shape, so they route through the same companion proxy without a second helper.
 */
export function proxiedSources<T extends { id: string; tiles: string[] }>(
  sources: T[],
  companionBase: string | null,
): T[] {
  if (companionBase === null) {
    return sources;
  }
  return sources.map((source) => ({
    ...source,
    tiles: [proxyTileTemplate(companionBase, source.id)],
  }));
}
