/** The single owner of Chart Locker companion health, polled for the header's offline-charts status
 * pill. Management requests authenticate with the browser's administrator cookie. A rejected request
 * is classified against Signal K's live login status so the UI never guesses that an administrator is
 * signed out merely because Chart Locker returned 401 or 403. */

import { fetchAdminSessionState } from '$shared/signalk';
import type { AccessRecoveryState } from '$shared/ui';
import { createRegionsClient, HttpStatusError, InvalidCacheStatsError } from './regions-client.js';

export const COMPANION_POLL_MS = 30_000;

// A 5xx or a transport fault can be a single dropped poll on a boat link, so require this many
// consecutive failures before the pill shows offline or error. One blip keeps the last state; recovery
// is immediate on the next success.
const COMPANION_FAIL_THRESHOLD = 2;

// The companion state IS the access-recovery state the shared note renders; one union, so the
// two cannot drift apart member by member.
export type CompanionState = AccessRecoveryState;

export class CompanionStatus {
  #getBase: () => string | null;
  #fetchImpl: typeof fetch | undefined;

  #state = $state<CompanionState>('checking');
  #cacheBytes = $state<number | null>(null);

  #timer: ReturnType<typeof setInterval> | null = null;
  #onResume: (() => void) | null = null;
  #inFlight = false;
  #failStreak = 0;

  constructor(getBase: () => string | null, fetchImpl?: typeof fetch) {
    this.#getBase = getBase;
    this.#fetchImpl = fetchImpl;
  }

  get present(): boolean {
    return this.#getBase() !== null;
  }

  get state(): CompanionState {
    return this.#state;
  }

  get down(): boolean {
    return this.#state === 'offline' || this.#state === 'error';
  }

  get cacheBytes(): number | null {
    return this.#cacheBytes;
  }

  refresh(): Promise<void> {
    return this.#tick();
  }

  start(): void {
    if (this.#timer !== null) return;
    this.#onResume = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void this.#tick();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.#onResume);
    }
    if (typeof window !== 'undefined') window.addEventListener('focus', this.#onResume);
    this.#timer = setInterval(() => void this.#tick(), COMPANION_POLL_MS);
    void this.#tick();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    if (this.#onResume !== null && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#onResume);
    }
    if (this.#onResume !== null && typeof window !== 'undefined') {
      window.removeEventListener('focus', this.#onResume);
    }
    this.#onResume = null;
  }

  async #classifyAccessRefusal(base: string): Promise<void> {
    const origin = new URL(base).origin;
    const session = await fetchAdminSessionState(origin, this.#fetchImpl);
    this.#state =
      session === 'signed-out'
        ? 'needs-login'
        : session === 'non-admin'
          ? 'needs-admin'
          : 'access-error';
  }

  async #tick(): Promise<void> {
    if (this.#inFlight) return;
    const base = this.#getBase();
    if (base === null) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    this.#inFlight = true;
    try {
      const stats = await createRegionsClient(base, this.#fetchImpl).getCacheStats();
      this.#state = 'serving';
      this.#cacheBytes = stats.bytes;
      this.#failStreak = 0;
    } catch (error) {
      if (error instanceof HttpStatusError && (error.status === 401 || error.status === 403)) {
        await this.#classifyAccessRefusal(base);
        this.#failStreak = 0;
      } else if (error instanceof InvalidCacheStatsError) {
        // A reachable companion with malformed data is a server error, not an unavailable service.
        this.#state = 'error';
        this.#failStreak = 0;
      } else {
        this.#failStreak += 1;
        if (this.#failStreak >= COMPANION_FAIL_THRESHOLD) {
          this.#state =
            error instanceof HttpStatusError && error.status >= 500 ? 'error' : 'offline';
        }
      }
    } finally {
      this.#inFlight = false;
    }
  }
}
