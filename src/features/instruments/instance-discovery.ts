import { isRecord } from '$shared/lib';
import {
  fetchAuthedJson,
  fetchAuthedJsonOutcome,
  fetchHistoryProviderPathCatalogs,
  fetchPopulatedHistoryPathsForProvider,
  type HistoryProviders,
} from '$shared/signalk';

export interface InstrumentInstances {
  batteries: string[];
  propulsion: string[];
  tanks: string[];
  solar: string[];
  inside: string[];
  paths: string[];
}

export interface LiveInstrumentDiscovery extends InstrumentInstances {
  failedFamilies: InstrumentFamily[];
}

type InstrumentFamily = 'batteries' | 'propulsion' | 'tanks' | 'solar' | 'inside';

const EMPTY_INSTANCES: InstrumentInstances = {
  batteries: [],
  propulsion: [],
  tanks: [],
  solar: [],
  inside: [],
  paths: [],
};

export interface HistoricalInstrumentDiscovery {
  state: 'complete' | 'partial' | 'failed';
  instances: InstrumentInstances;
}

// One year covers normal seasonal engine and sensor use without turning every catalog scan into an
// unbounded database query or reviving very old hardware names indefinitely.
export const INSTRUMENT_HISTORY_WINDOW_SECONDS = 365 * 24 * 60 * 60;

const BATTERY_BRANCH_KEYS = ['voltage', 'capacity', 'current'] as const;
const MAX_INSTANCES_PER_FAMILY = 100;
const MAX_RECOGNIZED_INSTRUMENT_PATHS = 500;
const MAX_INSTANCE_ID_LENGTH = 128;
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
const BATTERY_SUFFIXES = [
  ['voltage'],
  ['capacity', 'stateOfCharge'],
  ['capacity', 'timeRemaining'],
  ['current'],
] as const;
const PROPULSION_SUFFIXES = [
  ['revolutions'],
  ['temperature'],
  ['coolantTemperature'],
  ['oilPressure'],
  ['engineLoad'],
] as const;
const TANK_SUFFIXES = [['currentLevel'], ['currentVolume']] as const;
const SOLAR_SUFFIXES = [['panelPower'], ['panelCurrent'], ['yieldToday']] as const;
const INSIDE_SUFFIXES = [
  ['temperature'],
  ['relativeHumidity'],
  ['humidity'],
  ['pressure'],
] as const;

function hasAnyBranch(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.some((key) => key in value);
}

function isSignalKErrorEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.state === 'string' &&
    (typeof value.statusCode === 'number' || typeof value.statusCode === 'string') &&
    typeof value.message === 'string'
  );
}

function isValidInstanceId(id: string, tank = false): boolean {
  return (
    id.length <= MAX_INSTANCE_ID_LENGTH && (tank ? TANK_INSTANCE_ID_RE : INSTANCE_ID_RE).test(id)
  );
}

function sortedInstances(body: unknown, keys: readonly string[]): string[] {
  if (!isRecord(body)) return [];
  return Object.keys(body)
    .filter((id) => isValidInstanceId(id) && hasAnyBranch(body[id], keys))
    .sort()
    .slice(0, MAX_INSTANCES_PER_FAMILY);
}

function sortedTankInstances(body: unknown): string[] {
  if (!isRecord(body)) return [];
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(body)) {
    if (hasAnyBranch(value, TANK_BRANCH_KEYS)) {
      if (isValidInstanceId(key, true)) ids.add(key);
      continue;
    }
    if (!isRecord(value)) continue;
    for (const [instanceId, branch] of Object.entries(value)) {
      const id = `${key}.${instanceId}`;
      if (isValidInstanceId(id, true) && hasAnyBranch(branch, TANK_BRANCH_KEYS)) ids.add(id);
    }
  }
  return [...ids].sort().slice(0, MAX_INSTANCES_PER_FAMILY);
}

function hasNestedPath(value: unknown, suffix: readonly string[]): boolean {
  let current = value;
  for (const part of suffix) {
    if (!isRecord(current) || !(part in current)) return false;
    current = current[part];
  }
  return true;
}

function concretePaths(
  body: unknown,
  ids: readonly string[],
  prefix: string,
  suffixes: readonly (readonly string[])[],
): string[] {
  if (!isRecord(body)) return [];
  const paths: string[] = [];
  for (const id of ids) {
    const branch = id
      .split('.')
      .reduce<unknown>((value, part) => (isRecord(value) ? value[part] : undefined), body);
    for (const suffix of suffixes) {
      if (hasNestedPath(branch, suffix)) paths.push(`${prefix}.${id}.${suffix.join('.')}`);
    }
  }
  return paths;
}

export async function discoverInstrumentInstances(
  origin: string,
  token: string | undefined,
): Promise<LiveInstrumentDiscovery> {
  const [batteriesBody, propulsionBody, tanksBody, solarBody, insideBody] = await Promise.all([
    fetchAuthedJsonOutcome<unknown>(
      `${origin}/signalk/v1/api/vessels/self/electrical/batteries`,
      token,
    ),
    fetchAuthedJsonOutcome<unknown>(`${origin}/signalk/v1/api/vessels/self/propulsion`, token),
    fetchAuthedJsonOutcome<unknown>(`${origin}/signalk/v1/api/vessels/self/tanks`, token),
    fetchAuthedJsonOutcome<unknown>(
      `${origin}/signalk/v1/api/vessels/self/electrical/solar`,
      token,
    ),
    fetchAuthedJsonOutcome<unknown>(
      `${origin}/signalk/v1/api/vessels/self/environment/inside`,
      token,
    ),
  ]);
  const outcomes = { batteriesBody, propulsionBody, tanksBody, solarBody, insideBody };
  const failedFamilies = (Object.entries(outcomes) as Array<[string, typeof batteriesBody]>)
    .filter(
      ([, outcome]) =>
        outcome.state === 'failed' ||
        (outcome.state === 'ok' &&
          (!isRecord(outcome.value) || isSignalKErrorEnvelope(outcome.value))),
    )
    .map(([key]) => key.replace(/Body$/, '') as InstrumentFamily);
  const batteries = sortedInstances(batteriesBody.value, BATTERY_BRANCH_KEYS);
  const propulsion = sortedInstances(propulsionBody.value, PROPULSION_BRANCH_KEYS);
  const tanks = sortedTankInstances(tanksBody.value);
  const solar = sortedInstances(solarBody.value, SOLAR_BRANCH_KEYS);
  const inside = sortedInstances(insideBody.value, INSIDE_BRANCH_KEYS);
  const paths = [
    ...concretePaths(batteriesBody.value, batteries, 'electrical.batteries', BATTERY_SUFFIXES),
    ...concretePaths(propulsionBody.value, propulsion, 'propulsion', PROPULSION_SUFFIXES),
    ...concretePaths(tanksBody.value, tanks, 'tanks', TANK_SUFFIXES),
    ...concretePaths(solarBody.value, solar, 'electrical.solar', SOLAR_SUFFIXES),
    ...concretePaths(insideBody.value, inside, 'environment.inside', INSIDE_SUFFIXES),
  ].sort();
  return { batteries, propulsion, tanks, solar, inside, paths, failedFamilies };
}

function addInstance(target: Set<string>, id: string, tank = false): boolean {
  if (!isValidInstanceId(id, tank)) return false;
  target.add(id);
  return true;
}

// Convert the standard History API path catalog into only the dynamic families Binnacle can render.
// Keep the concrete paths too, so the controller can offer only readings that were actually stored.
export function historicalInstrumentInstances(paths: readonly string[]): InstrumentInstances {
  const batteries = new Set<string>();
  const propulsion = new Set<string>();
  const tanks = new Set<string>();
  const solar = new Set<string>();
  const inside = new Set<string>();
  const recognizedPaths = new Set<string>();

  for (const path of paths) {
    if (recognizedPaths.size >= MAX_RECOGNIZED_INSTRUMENT_PATHS) break;
    const parts = path.split('.');
    if (
      parts.length >= 4 &&
      parts[0] === 'electrical' &&
      parts[1] === 'batteries' &&
      ((parts.length === 4 && (parts[3] === 'voltage' || parts[3] === 'current')) ||
        (parts.length === 5 &&
          parts[3] === 'capacity' &&
          (parts[4] === 'stateOfCharge' || parts[4] === 'timeRemaining')))
    ) {
      if (addInstance(batteries, parts[2])) recognizedPaths.add(path);
      continue;
    }
    if (
      parts.length === 3 &&
      parts[0] === 'propulsion' &&
      PROPULSION_SUFFIXES.some((suffix) => suffix.length === 1 && suffix[0] === parts[2])
    ) {
      if (addInstance(propulsion, parts[1])) recognizedPaths.add(path);
      continue;
    }
    if (
      parts.length === 4 &&
      parts[0] === 'electrical' &&
      parts[1] === 'solar' &&
      SOLAR_SUFFIXES.some((suffix) => suffix[0] === parts[3])
    ) {
      if (addInstance(solar, parts[2])) recognizedPaths.add(path);
      continue;
    }
    if (
      parts.length === 4 &&
      parts[0] === 'environment' &&
      parts[1] === 'inside' &&
      INSIDE_SUFFIXES.some((suffix) => suffix[0] === parts[3])
    ) {
      if (addInstance(inside, parts[2])) recognizedPaths.add(path);
      continue;
    }
    if (parts[0] !== 'tanks') continue;
    const directKey = parts[2];
    const nestedKey = parts[3];
    if (parts.length === 3 && TANK_SUFFIXES.some((suffix) => suffix[0] === directKey)) {
      if (addInstance(tanks, parts[1], true)) recognizedPaths.add(path);
    } else if (parts.length === 4 && TANK_SUFFIXES.some((suffix) => suffix[0] === nestedKey)) {
      if (addInstance(tanks, `${parts[1]}.${parts[2]}`, true)) recognizedPaths.add(path);
    }
  }

  const sorted = (ids: Set<string>) => [...ids].sort().slice(0, MAX_INSTANCES_PER_FAMILY);
  return {
    batteries: sorted(batteries),
    propulsion: sorted(propulsion),
    tanks: sorted(tanks),
    solar: sorted(solar),
    inside: sorted(inside),
    paths: [...recognizedPaths].sort(),
  };
}

// Best-effort historical catalog discovery through Signal K's provider-neutral v2 API. QuestDB is
// the common provider, but no direct database endpoint or credentials are exposed to the webapp.
export async function discoverHistoricalInstrumentInstances(
  origin: string,
  token: string | undefined,
  providers: HistoryProviders,
  signal?: AbortSignal,
): Promise<HistoricalInstrumentDiscovery> {
  const providerCatalogs = await fetchHistoryProviderPathCatalogs(origin, token, providers, {
    durationSeconds: INSTRUMENT_HISTORY_WINDOW_SECONDS,
    signal,
  });
  const populated = new Set<string>();
  let complete = providerCatalogs.complete;
  let attemptedValidation = false;
  let answeredValidation = false;
  for (const catalog of providerCatalogs.catalogs) {
    if (signal?.aborted) break;
    const candidates = historicalInstrumentInstances(catalog.paths);
    attemptedValidation ||= candidates.paths.length > 0;
    const validated = await fetchPopulatedHistoryPathsForProvider(
      origin,
      token,
      catalog.provider,
      candidates.paths,
      INSTRUMENT_HISTORY_WINDOW_SECONDS,
      signal,
    );
    complete &&= validated.complete;
    answeredValidation ||= validated.answered;
    for (const path of validated.paths) populated.add(path);
  }
  if (providerCatalogs.catalogs.length === 0) {
    return { state: 'failed', instances: EMPTY_INSTANCES };
  }
  if (attemptedValidation && !answeredValidation) {
    return { state: 'failed', instances: EMPTY_INSTANCES };
  }
  return {
    state: complete ? 'complete' : 'partial',
    instances: historicalInstrumentInstances([...populated]),
  };
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
