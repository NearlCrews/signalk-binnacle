import { isRecord } from '$shared/lib';
import { fetchAuthedJson } from '$shared/signalk';

export const KIP_URL = '/@mxtommy/kip/';

// Probes the server's webapps list and returns true only when KIP is installed.
// Returns false on any failure (network error, non-OK status, unexpected body shape).
export async function detectKip(origin: string, token: string | undefined): Promise<boolean> {
  const data = await fetchAuthedJson<unknown>(`${origin}/skServer/webapps`, token);
  if (!Array.isArray(data)) return false;
  return data.some((entry) => isRecord(entry) && entry.name === '@mxtommy/kip');
}
