import { isRecord } from '$shared/lib';
import { fetchAuthedJson } from '$shared/signalk';
import { BATTERY_BRANCH_KEYS } from './tile-catalog';

// Enumerate battery instance ids from the Signal K electrical tree. Returns a sorted list of
// instance keys (e.g. ['house', 'starter']) or an empty array on any failure. The caller caches
// the result; this runs at most once per controller construction.
export async function discoverBatteries(
  origin: string,
  token: string | undefined,
): Promise<string[]> {
  const url = `${origin}/signalk/v1/api/vessels/self/electrical/batteries`;
  const body = await fetchAuthedJson<unknown>(url, token);
  if (!isRecord(body)) return [];
  // An instance with none of the measured branches (some sources publish a bare `.name` stub)
  // would only produce permanently empty tiles, so it does not count as a battery.
  return Object.keys(body)
    .filter((id) => {
      const instance = body[id];
      return isRecord(instance) && BATTERY_BRANCH_KEYS.some((key) => key in instance);
    })
    .sort();
}
