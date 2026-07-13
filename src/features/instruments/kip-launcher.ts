import { isRecord } from '$shared/lib';
import { fetchAuthedJson } from '$shared/signalk';

export const KIP_URL = '/@mxtommy/kip/';

// The webapps list is the clean install signal; probing KIP's own index html would depend on its
// serving quirks and could false-negative behind auth.
export async function detectKip(
  origin: string,
  token: string | undefined,
): Promise<boolean | undefined> {
  const data = await fetchAuthedJson<unknown>(`${origin}/skServer/webapps`, token);
  if (data === undefined) return undefined;
  if (!Array.isArray(data)) return false;
  return data.some((entry) => isRecord(entry) && entry.name === '@mxtommy/kip');
}
