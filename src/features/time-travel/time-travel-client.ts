import {
  fetchHistoryValuesAcrossProviders,
  HISTORY_RESOLUTION_SECONDS,
  HISTORY_WINDOW_SECONDS,
  type HistoryProviders,
  SK_PATHS,
} from '$shared/signalk';
import { type HistorySample, toSamples } from './time-travel-timeline';

export interface TimeTravelData {
  samples: HistorySample[];
  from: number;
  to: number;
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
  fetchValues: typeof fetchHistoryValuesAcrossProviders;
}

export async function loadTimeTravelHistory(
  origin: string,
  token: string | undefined,
  providers: HistoryProviders,
  deps: Deps = { fetchValues: fetchHistoryValuesAcrossProviders },
): Promise<TimeTravelData | undefined> {
  const got = await deps.fetchValues(origin, token, providers, {
    paths: PATHS,
    durationSeconds: HISTORY_WINDOW_SECONDS,
    resolutionSeconds: HISTORY_RESOLUTION_SECONDS,
  });
  if (!got) return undefined;
  const samples = toSamples(got.values);
  const parsedFrom = Date.parse(got.values.from);
  const parsedTo = Date.parse(got.values.to);
  const first = samples[0]?.t ?? 0;
  const last = samples[samples.length - 1]?.t ?? first;
  const from = Number.isFinite(parsedFrom) ? parsedFrom : first;
  const to = Number.isFinite(parsedTo) && parsedTo >= from ? parsedTo : Math.max(from, last);
  return {
    samples,
    from,
    to,
  };
}
