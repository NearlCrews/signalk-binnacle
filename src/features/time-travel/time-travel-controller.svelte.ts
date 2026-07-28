import type { HistoryProviders } from '$shared/signalk';
import {
  loadTimeTravelHistory,
  type TimeTravelData,
  type TimeTravelRequest,
} from './time-travel-client';
import {
  DEFAULT_TIME_TRAVEL_RANGE,
  type TimeTravelRangeId,
  type TimeTravelSpeed,
  timeTravelPreset,
} from './time-travel-presets';
import {
  nearestSample,
  nearestSampleWithin,
  nextPlaybackSample,
  previousPlaybackSample,
} from './time-travel-timeline';

export type TimeTravelStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'no-provider' | 'failed';
export type TimeTravelLoadErrorKind = 'failed' | 'empty' | 'no-provider';

export interface TimeTravelLoadError {
  kind: TimeTravelLoadErrorKind;
  rangeId: TimeTravelRangeId;
}

interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

interface MotionChange {
  readonly matches: boolean;
}

interface MotionSource {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: MotionChange) => void): void;
  removeEventListener(type: 'change', listener: (event: MotionChange) => void): void;
}

interface Deps {
  load: typeof loadTimeTravelHistory;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  getDocument: () => VisibilitySource | undefined;
  getMotionSource: () => MotionSource | undefined;
}

const defaultDeps: Deps = {
  load: loadTimeTravelHistory,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  getDocument: () => (typeof document === 'undefined' ? undefined : (document as VisibilitySource)),
  getMotionSource: () =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? undefined
      : (window.matchMedia('(prefers-reduced-motion: reduce)') as MotionSource),
};

const EMPTY_SAMPLES: TimeTravelData['samples'] = [];
const PLAYBACK_INTERVAL_MS = 700;

export interface TimeTravelController {
  readonly active: boolean;
  readonly status: TimeTravelStatus;
  readonly refreshing: boolean;
  readonly accepted: TimeTravelData | undefined;
  readonly requestedRangeId: TimeTravelRangeId | undefined;
  readonly rangeId: TimeTravelRangeId;
  readonly samples: TimeTravelData['samples'];
  readonly from: number;
  readonly to: number;
  readonly scrubMs: number;
  readonly current: TimeTravelData['samples'][number] | undefined;
  readonly markerSample: TimeTravelData['samples'][number] | undefined;
  readonly playing: boolean;
  readonly speed: TimeTravelSpeed;
  readonly reducedMotion: boolean;
  readonly error: TimeTravelLoadError | undefined;
  enter(): Promise<void>;
  exit(): void;
  reload(): Promise<void>;
  retry(): Promise<void>;
  setRange(id: TimeTravelRangeId): Promise<void>;
  setScrub(ms: number): void;
  step(direction: 1 | -1): void;
  goToLatest(): void;
  play(): void;
  pause(): void;
  setSpeed(speed: TimeTravelSpeed): void;
  dispose(): void;
}

export function createTimeTravelController(
  origin: string,
  getToken: () => string | undefined,
  getProviders: () => HistoryProviders | undefined,
  deps: Deps = defaultDeps,
): TimeTravelController {
  let active = $state(false);
  let status = $state<TimeTravelStatus>('idle');
  let refreshing = $state(false);
  let accepted = $state.raw<TimeTravelData | undefined>();
  let requestedRangeId = $state<TimeTravelRangeId | undefined>();
  let scrubMs = $state(0);
  let playing = $state(false);
  let speed = $state<TimeTravelSpeed>(1);
  let reducedMotion = $state(false);
  let error = $state<TimeTravelLoadError | undefined>();

  const samples = $derived(accepted?.samples ?? EMPTY_SAMPLES);
  const from = $derived(samples[0]?.t ?? accepted?.from ?? 0);
  const to = $derived(samples[samples.length - 1]?.t ?? accepted?.to ?? 0);
  const toleranceMs = $derived((accepted?.preset.resolutionSeconds ?? 0) * 1000);
  const current = $derived(
    toleranceMs > 0 ? nearestSampleWithin(samples, scrubMs, toleranceMs) : undefined,
  );
  const markerSample = $derived(
    current?.lon !== undefined && current.lat !== undefined ? current : undefined,
  );

  let disposed = false;
  let loadGeneration = 0;
  let loadAbort: AbortController | undefined;
  let playbackTimer: ReturnType<typeof setInterval> | undefined;
  let visibilitySource: VisibilitySource | undefined;
  let motionSource: MotionSource | undefined;

  const onVisibilityChange = () => {
    if (visibilitySource?.hidden) pause();
  };
  const onMotionChange = (event: MotionChange) => {
    reducedMotion = event.matches;
    if (event.matches) pause();
  };

  function attachBrowserLifecycle(): void {
    visibilitySource = deps.getDocument();
    visibilitySource?.addEventListener('visibilitychange', onVisibilityChange);
    motionSource = deps.getMotionSource();
    reducedMotion = motionSource?.matches ?? false;
    motionSource?.addEventListener('change', onMotionChange);
  }

  function detachBrowserLifecycle(): void {
    visibilitySource?.removeEventListener('visibilitychange', onVisibilityChange);
    motionSource?.removeEventListener('change', onMotionChange);
    visibilitySource = undefined;
    motionSource = undefined;
    reducedMotion = false;
  }

  function clearPlaybackTimer(): void {
    if (playbackTimer !== undefined) deps.clearInterval(playbackTimer);
    playbackTimer = undefined;
  }

  function pause(): void {
    playing = false;
    clearPlaybackTimer();
  }

  function commitScrub(ms: number): void {
    if (!Number.isFinite(ms)) return;
    scrubMs = Math.min(to, Math.max(from, ms));
  }

  function playbackTick(): void {
    const snapshot = accepted;
    const last = snapshot?.samples.at(-1);
    if (!snapshot || !last || snapshot.samples.length < 2) {
      pause();
      return;
    }
    const next = nextPlaybackSample(
      snapshot.samples,
      scrubMs,
      snapshot.preset.coarseStepSeconds * 1000,
    );
    if (!next || next.t <= scrubMs) {
      pause();
      return;
    }
    scrubMs = next.t;
    if (next.t >= last.t) pause();
  }

  function startPlaybackTimer(): void {
    clearPlaybackTimer();
    playbackTimer = deps.setInterval(playbackTick, PLAYBACK_INTERVAL_MS / speed);
  }

  function play(): void {
    const first = accepted?.samples[0];
    const last = accepted?.samples.at(-1);
    if (
      !active ||
      status !== 'ready' ||
      refreshing ||
      reducedMotion ||
      visibilitySource?.hidden ||
      !first ||
      !last ||
      first.t === last.t
    ) {
      pause();
      return;
    }
    if (scrubMs >= last.t) scrubMs = first.t;
    if (playing) return;
    playing = true;
    startPlaybackTimer();
  }

  function setSpeed(next: TimeTravelSpeed): void {
    if (next !== 0.5 && next !== 1 && next !== 2) return;
    speed = next;
    if (playing) startPlaybackTimer();
  }

  function setScrub(ms: number): void {
    pause();
    commitScrub(ms);
  }

  function step(direction: 1 | -1): void {
    const snapshot = accepted;
    if (!snapshot || snapshot.samples.length === 0) return;
    pause();
    const stepMs = snapshot.preset.coarseStepSeconds * 1000;
    const next =
      direction === 1
        ? nextPlaybackSample(snapshot.samples, scrubMs, stepMs)
        : previousPlaybackSample(snapshot.samples, scrubMs, stepMs);
    if (next) scrubMs = next.t;
  }

  function goToLatest(): void {
    const latest = accepted?.samples.at(-1);
    pause();
    if (latest) scrubMs = latest.t;
  }

  function retainFailure(kind: TimeTravelLoadErrorKind, rangeId: TimeTravelRangeId): void {
    refreshing = false;
    requestedRangeId = undefined;
    error = { kind, rangeId };
    status =
      accepted && accepted.samples.length > 0
        ? 'ready'
        : kind === 'no-provider'
          ? 'no-provider'
          : kind === 'empty'
            ? 'empty'
            : 'failed';
  }

  async function load(rangeId: TimeTravelRangeId): Promise<void> {
    if (!active || disposed) return;
    pause();
    const mine = ++loadGeneration;
    loadAbort?.abort();
    const abort = new AbortController();
    loadAbort = abort;
    requestedRangeId = rangeId;
    error = undefined;
    const retained = accepted && accepted.samples.length > 0;
    refreshing = !!retained;
    if (!retained) status = 'loading';
    const providers = getProviders();
    if (!providers || providers.ids.length === 0) {
      if (loadAbort === abort) loadAbort = undefined;
      retainFailure('no-provider', rangeId);
      return;
    }

    const request: TimeTravelRequest = {
      preset: timeTravelPreset(rangeId),
      preferredProvider: accepted?.provider,
      signal: abort.signal,
    };
    let data: TimeTravelData | undefined;
    try {
      data = await deps.load(origin, getToken(), providers, request);
    } catch {
      data = undefined;
    }
    if (mine !== loadGeneration || !active || disposed || abort.signal.aborted) return;
    if (loadAbort === abort) loadAbort = undefined;
    if (!data) {
      retainFailure('failed', rangeId);
      return;
    }
    if (data.samples.length === 0) {
      if (retained) {
        retainFailure('empty', rangeId);
        return;
      }
      accepted = data;
      scrubMs = data.to;
      status = 'empty';
      refreshing = false;
      requestedRangeId = undefined;
      return;
    }

    const previousSamples = accepted?.samples;
    const previousLast = previousSamples?.at(-1);
    const followedLatest = previousLast !== undefined && scrubMs === previousLast.t;
    const previousScrub = scrubMs;
    accepted = data;
    const first = data.samples[0];
    const last = data.samples.at(-1) ?? first;
    if (!previousLast || followedLatest) {
      scrubMs = last.t;
    } else {
      const clamped = Math.min(last.t, Math.max(first.t, previousScrub));
      scrubMs = nearestSample(data.samples, clamped)?.t ?? last.t;
    }
    status = 'ready';
    refreshing = false;
    requestedRangeId = undefined;
    error = undefined;
  }

  async function enter(): Promise<void> {
    if (disposed || active) return;
    active = true;
    attachBrowserLifecycle();
    await load(DEFAULT_TIME_TRAVEL_RANGE);
  }

  function exit(): void {
    loadGeneration += 1;
    loadAbort?.abort();
    loadAbort = undefined;
    pause();
    detachBrowserLifecycle();
    active = false;
    status = 'idle';
    refreshing = false;
    accepted = undefined;
    requestedRangeId = undefined;
    scrubMs = 0;
    error = undefined;
  }

  function reload(): Promise<void> {
    return load(accepted?.preset.id ?? DEFAULT_TIME_TRAVEL_RANGE);
  }

  function retry(): Promise<void> {
    return error ? load(error.rangeId) : reload();
  }

  function setRange(id: TimeTravelRangeId): Promise<void> {
    return load(id);
  }

  function dispose(): void {
    if (disposed) return;
    exit();
    disposed = true;
  }

  return {
    get active() {
      return active;
    },
    get status() {
      return status;
    },
    get refreshing() {
      return refreshing;
    },
    get accepted() {
      return accepted;
    },
    get requestedRangeId() {
      return requestedRangeId;
    },
    get rangeId() {
      return accepted?.preset.id ?? DEFAULT_TIME_TRAVEL_RANGE;
    },
    get samples() {
      return samples;
    },
    get from() {
      return from;
    },
    get to() {
      return to;
    },
    get scrubMs() {
      return scrubMs;
    },
    get current() {
      return current;
    },
    get markerSample() {
      return markerSample;
    },
    get playing() {
      return playing;
    },
    get speed() {
      return speed;
    },
    get reducedMotion() {
      return reducedMotion;
    },
    get error() {
      return error;
    },
    enter,
    exit,
    reload,
    retry,
    setRange,
    setScrub,
    step,
    goToLatest,
    play,
    pause,
    setSpeed,
    dispose,
  };
}
