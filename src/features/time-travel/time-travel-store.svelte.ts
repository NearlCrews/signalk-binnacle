import type { HistoryProviders } from '$shared/signalk';
import { loadTimeTravelHistory } from './time-travel-client';
import { type HistorySample, nearestPositioned, nearestSample } from './time-travel-timeline';

export type TimeTravelStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'no-provider' | 'failed';

interface Deps {
  load: typeof loadTimeTravelHistory;
}

export class TimeTravelStore {
  active = $state(false);
  status = $state<TimeTravelStatus>('idle');
  // Replace-only: the whole history track is reassigned wholesale on each load and read through the
  // deriveds below, never mutated in place, so raw state skips proxying hundreds of sample objects.
  samples = $state.raw<HistorySample[]>([]);
  from = $state(0);
  to = $state(0);
  scrubMs = $state(0);

  current = $derived(nearestSample(this.samples, this.scrubMs));
  markerSample = $derived(nearestPositioned(this.samples, this.scrubMs));

  #origin: string;
  #token: () => string | undefined;
  #providers: () => HistoryProviders | undefined;
  #deps: Deps;
  #loadSeq = 0;

  constructor(
    origin: string,
    token: () => string | undefined,
    providers: () => HistoryProviders | undefined,
    deps: Deps = { load: loadTimeTravelHistory },
  ) {
    this.#origin = origin;
    this.#token = token;
    this.#providers = providers;
    this.#deps = deps;
  }

  async enter(): Promise<void> {
    this.active = true;
    await this.#load();
  }

  exit(): void {
    this.active = false;
    this.status = 'idle';
    this.samples = [];
    this.from = 0;
    this.to = 0;
    this.scrubMs = 0;
  }

  setScrub(ms: number): void {
    this.scrubMs = Math.min(this.to, Math.max(this.from, ms));
  }

  reload(): Promise<void> {
    return this.#load();
  }

  goToLatest(): void {
    if (this.status === 'ready') this.setScrub(this.to);
  }

  async #load(): Promise<void> {
    const mine = ++this.#loadSeq;
    const providers = this.#providers();
    // A stock server with no history plugin returns { ids: [] } (truthy), so guard on the id count,
    // not just presence, or the query falls through to a 501 and reports failed instead of honestly
    // saying a provider is needed. Mirrors the history-track overlay's guard.
    if (!providers || providers.ids.length === 0) {
      this.samples = [];
      this.from = 0;
      this.to = 0;
      this.scrubMs = 0;
      this.status = 'no-provider';
      return;
    }
    this.status = 'loading';
    let data: Awaited<ReturnType<typeof loadTimeTravelHistory>>;
    try {
      data = await this.#deps.load(this.#origin, this.#token(), providers);
    } catch {
      data = undefined;
    }
    if (mine !== this.#loadSeq || !this.active) return;
    if (!data) {
      this.status = 'failed';
      return;
    }
    if (data.samples.length === 0) {
      this.samples = [];
      this.from = data.from;
      this.to = data.to;
      this.scrubMs = data.to;
      this.status = 'empty';
      return;
    }
    this.samples = data.samples;
    this.from = data.from;
    this.to = data.to;
    this.scrubMs = data.to;
    this.status = 'ready';
  }
}
