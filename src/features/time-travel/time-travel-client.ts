import { fetchHistoryValues, type HistoryProviders, SK_PATHS } from '$shared/signalk';
import type { TimeTravelPreset } from './time-travel-presets';
import { type HistorySample, toSamples } from './time-travel-timeline';

export interface TimeTravelData {
  samples: HistorySample[];
  from: number;
  to: number;
  provider: string;
  preset: TimeTravelPreset;
}

export interface TimeTravelRequest {
  preset: TimeTravelPreset;
  preferredProvider?: string;
  signal?: AbortSignal;
}

// Position is sent bare: the server defaults it to the `first` aggregate and the provider reads a
// special position table, so a numeric aggregate suffix would 400. The metrics carry their methods.
// Wind speed takes `:max` to surface the peak gust in each bucket; the other scalars take `:average`.
const PATHS: readonly string[] = [
  SK_PATHS.position,
  `${SK_PATHS.depthBelowTransducer}:average`,
  `${SK_PATHS.windSpeedApparent}:max`,
  `${SK_PATHS.outsidePressure}:average`,
  `${SK_PATHS.speedOverGround}:average`,
];

interface Deps {
  fetchValues: typeof fetchHistoryValues;
}

export async function loadTimeTravelHistory(
  origin: string,
  token: string | undefined,
  providers: HistoryProviders,
  request: TimeTravelRequest,
  deps: Deps = { fetchValues: fetchHistoryValues },
): Promise<TimeTravelData | undefined> {
  const ordered = [
    ...(request.preferredProvider && providers.ids.includes(request.preferredProvider)
      ? [request.preferredProvider]
      : []),
    ...providers.ids.filter((provider) => provider !== request.preferredProvider),
  ];
  let firstEmpty: TimeTravelData | undefined;
  let firstWithoutPosition: TimeTravelData | undefined;
  for (const provider of ordered) {
    if (request.signal?.aborted) return undefined;
    const values = await deps.fetchValues(origin, token, {
      paths: PATHS,
      durationSeconds: request.preset.durationSeconds,
      resolutionSeconds: request.preset.resolutionSeconds,
      provider,
      signal: request.signal,
    });
    if (request.signal?.aborted) return undefined;
    if (!values) continue;
    const parsedFrom = Date.parse(values.from);
    const parsedTo = Date.parse(values.to);
    const samples = toSamples(values, {
      fromMs: parsedFrom,
      toMs: parsedTo,
      maxRows: request.preset.maxRows,
    });
    if (!samples) continue;
    const data: TimeTravelData = {
      samples,
      from: parsedFrom,
      to: parsedTo,
      provider,
      preset: request.preset,
    };
    if (samples.some((sample) => sample.lon !== undefined && sample.lat !== undefined)) return data;
    if (samples.length > 0) firstWithoutPosition ??= data;
    else firstEmpty ??= data;
  }
  return firstWithoutPosition ?? firstEmpty;
}
