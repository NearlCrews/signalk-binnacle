/** The one place the webapp builds the companion plugin api base. Both companion webapp clients (the
 * regions client here and the PMTiles chart-management client) call companionApiUrl(companionBase, path),
 * where companionBase is the plugin base from detectCompanion (the server origin plus the plugin path),
 * the same base that baseStyleUrl and proxyTileTemplate use to build their URLs. The /api segment is spelled once
 * here, and the caller owns the rest of the path. */

const COMPANION_API_PATH = '/api';

export function companionApiUrl(companionBase: string, path: string): string {
  return `${companionBase}${COMPANION_API_PATH}${path}`;
}
