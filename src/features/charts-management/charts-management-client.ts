/** Talks to the companion chart-management routes. Admin-gated, so calls carry the bearer token
 * through the shared authInit, with companionApiUrl as the base, exactly like the regions client
 * and the other resource clients. Never throws: a failed read returns undefined so the panel keeps
 * its last list. */

import { companionApiUrl } from '$shared/companion';
import { withTimeout } from '$shared/lib';
import { authInit } from '$shared/signalk';

export interface ManagedChart {
  identifier: string;
  fileName: string;
  name: string;
  description: string;
  scale: number;
  bounds?: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  format: string;
  override: { name?: string; description?: string; scale?: number };
}

export interface ManagedChartsResponse {
  charts: ManagedChart[];
  invalid: Array<{ fileName: string; error: string }>;
}

export async function fetchManagedCharts(
  origin: string,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ManagedChartsResponse | undefined> {
  try {
    const response = await fetchImpl(
      companionApiUrl(origin, '/charts'),
      withTimeout(authInit(token)),
    );
    if (!response.ok) return undefined;
    return (await response.json()) as ManagedChartsResponse;
  } catch {
    return undefined;
  }
}

export async function putChartOverride(
  origin: string,
  token: string | undefined,
  id: string,
  override: { name?: string; description?: string; scale?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      companionApiUrl(origin, `/charts/${encodeURIComponent(id)}/override`),
      withTimeout(
        authInit(token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(override),
        }),
      ),
    );
    return response.ok;
  } catch {
    return false;
  }
}
