// Detects the Chart Locker tile proxy. When the Chart Locker plugin is installed, the chartplotter
// fetches the remote raster overlays (and, later, the basemap) through the Signal K server so the boat
// shares one cache and works offline at sea. When it is absent, every source keeps its direct upstream
// URL, so a standalone install is unchanged.

import { proxyTileTemplate } from 'signalk-chart-sources';
import { adminSessionInit, authInit } from '$shared/signalk';

const COMPANION_PATH = '/plugins/signalk-chart-locker';

/**
 * Probe whether the companion tile proxy is installed. A 503 from this route means Chart Locker is
 * installed but its container is not ready, so it still proves presence. Try the browser administrator
 * session first because a device bearer token can mask a valid cookie, then fall back to that token for
 * ordinary approved Binnacle sessions. A 404 proves absence; 401 and 403 prove neither because Signal K
 * can reject requests before route matching.
 */
export async function detectCompanion(
  origin: string,
  token?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const base = `${origin}${COMPANION_PATH}`;
  try {
    const probe = (init: RequestInit): Promise<Response> =>
      fetchImpl(`${base}/tiles/ready`, {
        ...init,
        signal: AbortSignal.timeout(2000),
      });
    let response = await probe(adminSessionInit());
    if ((response.status === 401 || response.status === 403) && token) {
      response = await probe({ ...adminSessionInit(), ...authInit(token) });
    }
    return response.ok || response.status === 503 ? base : null;
  } catch {
    return null;
  }
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
