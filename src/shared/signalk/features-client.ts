import { hasControlCharacters, isRecord } from '$shared/lib';
import { SignalKResourceClient } from './resource';

const MAX_FEATURE_ENTRIES = 4_096;
const MAX_FEATURE_ID_LENGTH = 256;
const MAX_FEATURE_VERSION_LENGTH = 128;

function safeFeatureText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !hasControlCharacters(value)
  );
}

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
  if (!isRecord(body)) return undefined;
  if (body.apis !== undefined && !Array.isArray(body.apis)) return undefined;
  if (body.plugins !== undefined && !Array.isArray(body.plugins)) return undefined;
  const apis = new Set<string>();
  if (Array.isArray(body.apis)) {
    if (body.apis.length > MAX_FEATURE_ENTRIES) return undefined;
    for (const api of body.apis) {
      if (safeFeatureText(api, MAX_FEATURE_ID_LENGTH)) apis.add(api);
    }
  }
  const plugins = new Map<string, string>();
  if (Array.isArray(body.plugins)) {
    if (body.plugins.length > MAX_FEATURE_ENTRIES) return undefined;
    for (const plugin of body.plugins) {
      if (isRecord(plugin)) {
        const { id, version } = plugin as { id?: unknown; version?: unknown };
        if (safeFeatureText(id, MAX_FEATURE_ID_LENGTH)) {
          plugins.set(id, safeFeatureText(version, MAX_FEATURE_VERSION_LENGTH) ? version : '');
        }
      }
    }
  }
  return { apis, plugins };
}
