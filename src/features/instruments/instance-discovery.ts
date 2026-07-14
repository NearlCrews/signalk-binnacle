import { isRecord } from '$shared/lib';
import { fetchAuthedJson } from '$shared/signalk';

export interface InstrumentInstances {
  batteries: string[];
  propulsion: string[];
  tanks: string[];
  solar: string[];
  inside: string[];
}

export const EMPTY_INSTANCES: InstrumentInstances = {
  batteries: [],
  propulsion: [],
  tanks: [],
  solar: [],
  inside: [],
};

const BATTERY_BRANCH_KEYS = ['voltage', 'capacity', 'current'] as const;
const MAX_INSTANCES_PER_FAMILY = 100;
const INSTANCE_ID_RE = /^[A-Za-z0-9_-]+$/;
const TANK_INSTANCE_ID_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/;
const PROPULSION_BRANCH_KEYS = [
  'revolutions',
  'temperature',
  'oilPressure',
  'coolantTemperature',
  'engineLoad',
  'transmission',
] as const;
const TANK_BRANCH_KEYS = ['currentLevel', 'currentVolume', 'capacity', 'type'] as const;
const SOLAR_BRANCH_KEYS = ['panelPower', 'panelCurrent', 'yieldToday', 'loadCurrent'] as const;
const INSIDE_BRANCH_KEYS = ['temperature', 'relativeHumidity', 'humidity', 'pressure'] as const;

function hasAnyBranch(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.some((key) => key in value);
}

function sortedInstances(body: unknown, keys: readonly string[]): string[] {
  if (!isRecord(body)) return [];
  return Object.keys(body)
    .filter((id) => INSTANCE_ID_RE.test(id) && hasAnyBranch(body[id], keys))
    .sort()
    .slice(0, MAX_INSTANCES_PER_FAMILY);
}

function sortedTankInstances(body: unknown): string[] {
  if (!isRecord(body)) return [];
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(body)) {
    if (hasAnyBranch(value, TANK_BRANCH_KEYS)) {
      if (TANK_INSTANCE_ID_RE.test(key)) ids.add(key);
      continue;
    }
    if (!isRecord(value)) continue;
    for (const [instanceId, branch] of Object.entries(value)) {
      const id = `${key}.${instanceId}`;
      if (TANK_INSTANCE_ID_RE.test(id) && hasAnyBranch(branch, TANK_BRANCH_KEYS)) ids.add(id);
    }
  }
  return [...ids].sort().slice(0, MAX_INSTANCES_PER_FAMILY);
}

async function discoverBranch(
  origin: string,
  token: string | undefined,
  path: string,
  keys: readonly string[],
): Promise<string[]> {
  const body = await fetchAuthedJson<unknown>(`${origin}${path}`, token);
  return sortedInstances(body, keys);
}

export async function discoverInstrumentInstances(
  origin: string,
  token: string | undefined,
): Promise<InstrumentInstances> {
  const [batteries, propulsion, tanks, solar, inside] = await Promise.all([
    discoverBranch(
      origin,
      token,
      '/signalk/v1/api/vessels/self/electrical/batteries',
      BATTERY_BRANCH_KEYS,
    ),
    discoverBranch(
      origin,
      token,
      '/signalk/v1/api/vessels/self/propulsion',
      PROPULSION_BRANCH_KEYS,
    ),
    fetchAuthedJson<unknown>(`${origin}/signalk/v1/api/vessels/self/tanks`, token).then(
      sortedTankInstances,
      () => [],
    ),
    discoverBranch(
      origin,
      token,
      '/signalk/v1/api/vessels/self/electrical/solar',
      SOLAR_BRANCH_KEYS,
    ),
    discoverBranch(
      origin,
      token,
      '/signalk/v1/api/vessels/self/environment/inside',
      INSIDE_BRANCH_KEYS,
    ),
  ]);
  return { batteries, propulsion, tanks, solar, inside };
}

export async function discoverBatteries(
  origin: string,
  token: string | undefined,
): Promise<string[]> {
  const body = await fetchAuthedJson<unknown>(
    `${origin}/signalk/v1/api/vessels/self/electrical/batteries`,
    token,
  );
  return sortedInstances(body, BATTERY_BRANCH_KEYS);
}
