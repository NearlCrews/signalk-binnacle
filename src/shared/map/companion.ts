// Detects the Chart Locker tile proxy. When the Chart Locker plugin is installed, the chartplotter
// fetches the remote raster overlays (and, later, the basemap) through the Signal K server so the boat
// shares one cache and works offline at sea. When it is absent, every source keeps its direct upstream
// URL, so a standalone install is unchanged.

import { proxyTileTemplate } from 'signalk-chart-sources';

const COMPANION_PATH = '/plugins/signalk-chart-locker';

/**
 * Probe whether the companion tile proxy is installed and ready. Returns its plugin base URL on a 200,
 * or null on a 404 or any network error (the standalone case).
 */
export async function detectCompanion(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const base = `${origin}${COMPANION_PATH}`;
  try {
    // The map cannot build until this resolves (baseStyleUrl is read synchronously at construction), so
    // bound the wait: a server that accepts the connection but never answers must not hang map init.
    const response = await fetchImpl(`${base}/tiles/ready`, { signal: AbortSignal.timeout(2000) });
    return response.ok ? base : null;
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
