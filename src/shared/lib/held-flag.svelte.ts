import type { ReactiveClock } from './clock.svelte';

// A condition held continuously for a window against the reactive clock, the shared shape behind
// "warn only once this has been true for N seconds" surfaces (the alarm-audio gate, the anchor
// server-stale grace). The since memo is plain, not $state: the derived writes it to remember
// when the run began. An unobserved down window cannot clear the memo (nothing evaluates the
// derived while no one reads it), so a consumer with an imperative per-pass hook should call
// reset() there whenever the condition is down.
export class HeldFlag {
  #clock: ReactiveClock;
  #windowMs: number;
  #condition: () => boolean;
  #since: number | undefined;

  // seed stamps a run already in progress at construction, so the window counts from creation
  // rather than from the first read (a page-load grace must not restart when a panel first asks).
  constructor(clock: ReactiveClock, windowMs: number, condition: () => boolean, seed = false) {
    this.#clock = clock;
    this.#windowMs = windowMs;
    this.#condition = condition;
    if (seed && condition()) this.#since = clock.now;
  }

  #held = $derived.by(() => {
    if (!this.#condition()) {
      this.#since = undefined;
      return false;
    }
    const now = this.#clock.now;
    this.#since ??= now;
    return now - this.#since >= this.#windowMs;
  });

  get held(): boolean {
    return this.#held;
  }

  reset(): void {
    this.#since = undefined;
  }
}
