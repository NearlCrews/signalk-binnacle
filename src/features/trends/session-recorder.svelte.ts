import type {
  InstrumentTrendCandidate,
  InstrumentTrendDescriptor,
} from '$entities/instrument-trend';
import { isFiniteNumber } from '$shared/lib';
import type { AttributedTrendSeries } from './trend-metrics';

export const TREND_SAMPLE_MS = 30_000;
export const MAX_TREND_SESSION_SAMPLES = 2_880;

export interface TrendPathSample {
  value: unknown;
  epoch: number;
}

interface Buffer {
  times: number[];
  values: Array<number | null>;
  selectedPath?: string;
  startedAtSec: number;
}

export interface SessionTrendSeries extends AttributedTrendSeries {
  startedAtSec?: number;
}

// A bounded per-instrument recorder. Each series latches the first candidate that produces a fresh
// sample, so a higher-priority source appearing later cannot draw an artificial step into the data.
export class TrendSessionRecorder {
  #buffers = new Map<string, Buffer>();
  #interval: ReturnType<typeof setInterval> | undefined;
  #version = $state(0);

  get version(): number {
    return this.#version;
  }

  retain(ids: ReadonlySet<string>): void {
    let changed = false;
    for (const id of this.#buffers.keys()) {
      if (!ids.has(id)) {
        this.#buffers.delete(id);
        changed = true;
      }
    }
    if (changed) this.#version += 1;
  }

  start(
    descriptors: () => readonly InstrumentTrendDescriptor[],
    read: (path: string) => TrendPathSample,
    now: () => number = Date.now,
  ): () => void {
    this.stop();
    const tick = () => this.record(descriptors(), read, now());
    tick();
    this.#interval = setInterval(tick, TREND_SAMPLE_MS);
    return () => this.stop();
  }

  stop(): void {
    if (this.#interval !== undefined) clearInterval(this.#interval);
    this.#interval = undefined;
  }

  record(
    descriptors: readonly InstrumentTrendDescriptor[],
    read: (path: string) => TrendPathSample,
    nowMs: number,
  ): void {
    const timeSec = nowMs / 1000;
    for (const descriptor of descriptors) {
      let buffer = this.#buffers.get(descriptor.id);
      if (!buffer) {
        buffer = { times: [], values: [], startedAtSec: timeSec };
        this.#buffers.set(descriptor.id, buffer);
      }
      const selected = this.#sampleFor(buffer, descriptor.candidates, read, nowMs);
      const candidate = selected?.candidate;
      const sample = selected?.sample;
      const fresh =
        candidate !== undefined &&
        sample !== undefined &&
        sample.epoch > 0 &&
        nowMs - sample.epoch <= candidate.staleAfterMs &&
        isFiniteNumber(sample.value);
      buffer.times.push(timeSec);
      buffer.values.push(fresh && typeof sample?.value === 'number' ? sample.value : null);
      if (buffer.times.length > MAX_TREND_SESSION_SAMPLES) {
        const drop = buffer.times.length - MAX_TREND_SESSION_SAMPLES;
        buffer.times.splice(0, drop);
        buffer.values.splice(0, drop);
      }
    }
    if (descriptors.length > 0) this.#version += 1;
  }

  #sampleFor(
    buffer: Buffer,
    candidates: readonly InstrumentTrendCandidate[],
    read: (path: string) => TrendPathSample,
    nowMs: number,
  ): { candidate: InstrumentTrendCandidate; sample: TrendPathSample } | undefined {
    if (buffer.selectedPath) {
      const candidate = candidates.find((entry) => entry.path === buffer.selectedPath);
      return candidate ? { candidate, sample: read(candidate.path) } : undefined;
    }
    for (const candidate of candidates) {
      const sample = read(candidate.path);
      const fresh =
        sample.epoch > 0 &&
        nowMs - sample.epoch <= candidate.staleAfterMs &&
        isFiniteNumber(sample.value);
      if (!fresh) continue;
      buffer.selectedPath = candidate.path;
      return { candidate, sample };
    }
    return undefined;
  }

  series(id: string, descriptor?: InstrumentTrendDescriptor): SessionTrendSeries {
    const buffer = this.#buffers.get(id);
    if (!buffer) return { times: [], values: [] };
    const candidate = descriptor?.candidates.find((entry) => entry.path === buffer.selectedPath);
    return {
      times: buffer.times,
      values: buffer.values,
      path: buffer.selectedPath,
      referenceLabel: candidate?.referenceLabel,
      startedAtSec: buffer.startedAtSec,
    };
  }
}
