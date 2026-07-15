import { SignalKResourceClient } from './resource';

// The server's v2 feature-discovery endpoint: GET /signalk/v2/features answers with the
// available API ids and the installed plugins, so a client can detect (for example) the
// Notifications API before preferring its REST routes over raw v1 deltas. enabled=1 narrows
// the plugin list to enabled plugins; the apis list is unaffected by it.
export interface ServerFeatures {
  apis: ReadonlySet<string>;
  plugins: ReadonlyMap<string, string>;
}

export async function fetchServerFeatures(
  base: string,
  token?: string,
): Promise<ServerFeatures | undefined> {
  const body = await new SignalKResourceClient({ getToken: () => token }).fetchJson<{
    apis?: unknown;
    plugins?: unknown;
  }>(`${base}/signalk/v2/features?enabled=1`);
  if (!body || typeof body !== 'object') return undefined;
  const apis = new Set<string>();
  if (Array.isArray(body.apis)) {
    for (const api of body.apis) {
      if (typeof api === 'string') apis.add(api);
    }
  }
  const plugins = new Map<string, string>();
  if (Array.isArray(body.plugins)) {
    for (const plugin of body.plugins) {
      if (plugin && typeof plugin === 'object') {
        const { id, version } = plugin as { id?: unknown; version?: unknown };
        if (typeof id === 'string') plugins.set(id, typeof version === 'string' ? version : '');
      }
    }
  }
  return { apis, plugins };
}
