import type { InstrumentTrendDescriptor } from '$entities/instrument-trend';
import { DAY_MS } from '$shared/lib';
import {
  fetchHistoryValues,
  type HistoryProviders,
  type HistoryValues,
  MAX_HISTORY_QUERY_PATHS,
} from '$shared/signalk';
import type { AttributedTrendSeries } from './trend-metrics';

export const TREND_WINDOW_SECONDS = DAY_MS / 1000;
export const TREND_RESOLUTION_SECONDS = 300;

export type TrendHistoryState = 'complete' | 'partial' | 'empty' | 'failed';

export interface TrendHistory {
  series: ReadonlyMap<string, AttributedTrendSeries>;
  state: TrendHistoryState;
  failedProviders: readonly string[];
  answeredProviders: readonly string[];
}

interface Deps {
  fetchValues: typeof fetchHistoryValues;
}

interface ProviderBatch {
  provider: string;
  requested: readonly string[];
  values: HistoryValues | undefined;
}

function requestKey(path: string, aggregate: string): string {
  return `${path}:${aggregate}`;
}

function batchesFor(descriptors: readonly InstrumentTrendDescriptor[]): string[][] {
  const requests = [
    ...new Set(
      descriptors.flatMap((descriptor) =>
        descriptor.candidates.map((candidate) => requestKey(candidate.path, descriptor.aggregate)),
      ),
    ),
  ];
  const batches: string[][] = [];
  for (let offset = 0; offset < requests.length; offset += MAX_HISTORY_QUERY_PATHS) {
    batches.push(requests.slice(offset, offset + MAX_HISTORY_QUERY_PATHS));
  }
  return batches;
}

function columnsFor(values: HistoryValues, path: string, method: string): number[] {
  const exact: number[] = [];
  const pathOnly: number[] = [];
  values.columns.forEach((column, index) => {
    if (column.path !== path) return;
    pathOnly.push(index);
    if (column.method === method) exact.push(index);
  });
  if (exact.length > 0) return exact;
  // Some providers omit the method echo. Accept that compatibility shape only when the single
  // matching column has a blank method. A different nonblank method is a different aggregate, not
  // an alias for the one requested.
  return pathOnly.length === 1 && values.columns[pathOnly[0]].method === '' ? pathOnly : [];
}

function extractSeries(
  batches: readonly ProviderBatch[],
  provider: string,
  path: string,
  aggregate: string,
): { series?: AttributedTrendSeries; invalidColumn: boolean } {
  const key = requestKey(path, aggregate);
  const batch = batches.find(
    (entry) => entry.provider === provider && entry.requested.includes(key),
  );
  if (!batch?.values) return { invalidColumn: false };
  const columns = columnsFor(batch.values, path, aggregate);
  // A successful response must account for every requested column even when it has no rows or only
  // null values. Missing, duplicated, or method-mismatched columns are partial provider failures.
  if (columns.length !== 1) return { invalidColumn: true };
  const column = columns[0];
  const times: number[] = [];
  const values: Array<number | null> = [];
  for (const row of batch.values.rows) {
    const epochMs = Date.parse(row[0]);
    if (!Number.isFinite(epochMs)) continue;
    const value = row[column + 1];
    times.push(epochMs / 1000);
    values.push(typeof value === 'number' && Number.isFinite(value) ? value : null);
  }
  return { series: { times, values, path, provider }, invalidColumn: false };
}

function hasSamples(series: AttributedTrendSeries | undefined): boolean {
  return series?.values.some((value) => value != null) ?? false;
}

// Every provider is queried once per deduplicated batch. Resolution is descriptor-local: candidate
// priority wins first, then provider order, and a chart never merges samples from two providers.
export async function loadTrendHistory(
  origin: string,
  token: string | undefined,
  providers: HistoryProviders,
  descriptors: readonly InstrumentTrendDescriptor[],
  signal?: AbortSignal,
  deps: Deps = { fetchValues: fetchHistoryValues },
): Promise<TrendHistory> {
  const requestBatches = batchesFor(descriptors);
  if (requestBatches.length === 0 || providers.ids.length === 0) {
    return {
      series: new Map(),
      state: 'empty',
      failedProviders: [],
      answeredProviders: [],
    };
  }

  const calls = providers.ids.flatMap((provider) =>
    requestBatches.map(async (requested): Promise<ProviderBatch> => {
      try {
        const values = await deps.fetchValues(origin, token, {
          paths: requested,
          durationSeconds: TREND_WINDOW_SECONDS,
          resolutionSeconds: TREND_RESOLUTION_SECONDS,
          provider,
          signal,
        });
        return { provider, requested, values };
      } catch (error) {
        if (signal?.aborted) throw error;
        return { provider, requested, values: undefined };
      }
    }),
  );
  const results = await Promise.all(calls);
  if (signal?.aborted) throw new DOMException('Trend history request aborted.', 'AbortError');

  const answeredProviders = providers.ids.filter((provider) =>
    results.some((result) => result.provider === provider && result.values !== undefined),
  );
  const failedProviders = providers.ids.filter(
    (provider) =>
      !results
        .filter((result) => result.provider === provider)
        .every((result) => result.values !== undefined),
  );
  if (answeredProviders.length === 0) {
    return {
      series: new Map(),
      state: 'failed',
      failedProviders,
      answeredProviders,
    };
  }

  const series = new Map<string, AttributedTrendSeries>();
  let invalidColumn = false;
  for (const descriptor of descriptors) {
    let selected: AttributedTrendSeries | undefined;
    for (const candidate of descriptor.candidates) {
      for (const provider of providers.ids) {
        const extracted = extractSeries(results, provider, candidate.path, descriptor.aggregate);
        invalidColumn ||= extracted.invalidColumn;
        const candidateSeries = extracted.series;
        if (!candidateSeries || !hasSamples(candidateSeries)) continue;
        selected = {
          ...candidateSeries,
          referenceLabel: candidate.referenceLabel,
        };
        break;
      }
      if (selected) break;
    }
    if (selected) series.set(descriptor.id, selected);
  }

  const partial = failedProviders.length > 0 || invalidColumn;
  return {
    series,
    state: partial ? 'partial' : series.size > 0 ? 'complete' : 'empty',
    failedProviders,
    answeredProviders,
  };
}
