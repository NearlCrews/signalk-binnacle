import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstrumentTrendDescriptor } from '$entities/instrument-trend';
import {
  MAX_TREND_SESSION_SAMPLES,
  TREND_SAMPLE_MS,
  TrendSessionRecorder,
} from './session-recorder.svelte';

const descriptor = (id: string, paths: string[] = [`path.${id}`]): InstrumentTrendDescriptor => ({
  id,
  label: id,
  description: id,
  category: 'navigation',
  candidates: paths.map((path) => ({
    path,
    minPeriodMs: 1000,
    staleAfterMs: 10_000,
  })),
  aggregate: 'average',
  display: 'count',
  metricPrecision: 0,
  imperialPrecision: 0,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TrendSessionRecorder', () => {
  it('records fresh finite samples and null gaps', () => {
    const recorder = new TrendSessionRecorder();
    const values = new Map<string, unknown>([
      ['path.depth', 4.2],
      ['path.wind', Number.NaN],
    ]);
    recorder.record(
      [descriptor('depth'), descriptor('wind')],
      (path) => ({ value: values.get(path), epoch: 30_000 }),
      30_000,
    );
    expect(recorder.series('depth')).toMatchObject({ times: [30], values: [4.2] });
    expect(recorder.series('wind').values).toEqual([null]);
    expect(recorder.version).toBe(1);
  });

  it('latches one fallback candidate for the entire session series', () => {
    const recorder = new TrendSessionRecorder();
    const depth = descriptor('depth', ['primary', 'fallback']);
    const samples = new Map([
      ['primary', { value: undefined, epoch: 0 }],
      ['fallback', { value: 5, epoch: 30_000 }],
    ]);
    const read = (path: string) => samples.get(path) ?? { value: undefined, epoch: 0 };
    recorder.record([depth], read, 30_000);
    samples.set('primary', { value: 3, epoch: 60_000 });
    samples.set('fallback', { value: 6, epoch: 60_000 });
    recorder.record([depth], read, 60_000);
    expect(recorder.series('depth', depth)).toMatchObject({
      values: [5, 6],
      path: 'fallback',
    });
  });

  it('samples immediately, then per interval, and stops cleanly', () => {
    const recorder = new TrendSessionRecorder();
    const depth = descriptor('depth');
    let value = 1;
    const stop = recorder.start(
      () => [depth],
      () => ({ value: value++, epoch: Date.now() || 1 }),
      () => Date.now() || 1,
    );
    expect(recorder.series('depth').values).toEqual([1]);
    vi.advanceTimersByTime(TREND_SAMPLE_MS * 2);
    expect(recorder.series('depth').values).toEqual([1, 2, 3]);
    stop();
    vi.advanceTimersByTime(TREND_SAMPLE_MS);
    expect(recorder.series('depth').values).toEqual([1, 2, 3]);
  });

  it('caps each series at 2,880 samples', () => {
    const recorder = new TrendSessionRecorder();
    const depth = descriptor('depth');
    for (let index = 0; index < MAX_TREND_SESSION_SAMPLES + 2; index += 1) {
      const now = (index + 1) * TREND_SAMPLE_MS;
      recorder.record([depth], () => ({ value: index, epoch: now }), now);
    }
    const series = recorder.series('depth');
    expect(series.times).toHaveLength(MAX_TREND_SESSION_SAMPLES);
    expect(series.values[0]).toBe(2);
    expect(series.values.at(-1)).toBe(MAX_TREND_SESSION_SAMPLES + 1);
  });

  it('drops buffers that are no longer selected or focused', () => {
    const recorder = new TrendSessionRecorder();
    const depth = descriptor('depth');
    recorder.record([depth], () => ({ value: 4, epoch: 30_000 }), 30_000);
    recorder.retain(new Set());
    expect(recorder.series('depth')).toEqual({ times: [], values: [] });
  });
});
