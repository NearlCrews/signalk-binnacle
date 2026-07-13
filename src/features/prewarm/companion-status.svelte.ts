/** The single owner of Chart Locker companion health, polled for the header's offline-charts status
 * pill. It rebuilds the regions client with the live token every tick, so a token that arrives after
 * admin approval or rotates mid-session is always current, and it never captures a stale one. It lives
 * in the offline-charts feature because it drives that feature's cache-stats client; the app composes
 * one instance and reads its getters into the presenter pill. */

import { createRegionsClient, HttpStatusError } from './regions-client.js';

export const COMPANION_POLL_MS = 30_000;

// A 5xx or a transport fault can be a single dropped poll on a boat link, so require this many
// consecutive failures before the pill shows offline or error. One blip keeps the last state; recovery
// is immediate on the next success.
const COMPANION_FAIL_THRESHOLD = 2;

export type CompanionState = 'serving' | 'needs-auth' | 'offline' | 'error';

export class CompanionStatus {
  #getBase: () => string | null;
  #getToken: () => string | null;
  #fetchImpl: typeof fetch | undefined;

  #state = $state<CompanionState>('needs-auth');
  #cacheBytes = $state<number | null>(null);

  #timer: ReturnType<typeof setInterval> | null = null;
  #onVisibility: (() => void) | null = null;
  #inFlight = false;
  // Consecutive 5xx or transport failures, so a single dropped poll does not flicker the pill to
  // offline. Reset on any success or auth answer.
  #failStreak = 0;
  // The exact credential a 401 or 403 refused, undefined when nothing is refused. While the live
  // credential still equals it the poller stays backed off, so a secured server is not re-hit with the
  // same refused credential every interval. This tracks a null credential too: a secured server that
  // refuses the anonymous viewer backs off instead of 401-spamming, yet the moment a real token arrives
  // (token !== the refused null) it polls again. Fresh or refreshed access likewise clears it.
  #refusedCred: string | null | undefined = undefined;

  constructor(
    getBase: () => string | null,
    getToken: () => string | null,
    fetchImpl?: typeof fetch,
  ) {
    this.#getBase = getBase;
    this.#getToken = getToken;
    this.#fetchImpl = fetchImpl;
  }

  // Present is derived from the base, not stored, so a late detectCompanion resolution flips the chip
  // on without the poller having run.
  get present(): boolean {
    return this.#getBase() !== null;
  }

  get state(): CompanionState {
    return this.#state;
  }

  // The not-responding projection of the state machine. The announce boundary and any health consumer
  // read this rather than re-partitioning the enum, so a new state is classified here, once.
  get down(): boolean {
    return this.#state === 'offline' || this.#state === 'error';
  }

  get cacheBytes(): number | null {
    return this.#cacheBytes;
  }

  start(): void {
    // Idempotent: a visibility resume or a double mount must not stack a second interval or listener.
    if (this.#timer !== null) return;
    if (typeof document !== 'undefined') {
      this.#onVisibility = () => {
        if (!document.hidden) void this.#tick();
      };
      document.addEventListener('visibilitychange', this.#onVisibility);
    }
    this.#timer = setInterval(() => void this.#tick(), COMPANION_POLL_MS);
    // An immediate first poll resolves serving versus not-reachable within a tick rather than after the
    // full interval.
    void this.#tick();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    if (this.#onVisibility !== null && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#onVisibility);
    }
    this.#onVisibility = null;
  }

  async #tick(): Promise<void> {
    // Requests self-abort under the client's withTimeout well inside the interval, so a single
    // in-flight guard is enough to keep polls from piling up; no own AbortController.
    if (this.#inFlight) return;
    const base = this.#getBase();
    if (base === null) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    // Read the live credential but do NOT early-return on a null token: an unsecured server answers the
    // stats route 200 to everyone, so a tokenless viewer there must poll and reach serving. Only a
    // credential that was actually refused (recorded in #refusedCred) backs the poller off.
    const token = this.#getToken();

    // Stay backed off while the live credential is still the exact one a 401 or 403 refused (a null
    // token included); any other credential clears the block and polls again.
    if (this.#refusedCred !== undefined && this.#refusedCred === token) return;

    this.#inFlight = true;
    try {
      const stats = await createRegionsClient(
        base,
        token ?? undefined,
        this.#fetchImpl,
      ).getCacheStats();
      this.#state = 'serving';
      this.#cacheBytes = stats.bytes;
      this.#refusedCred = undefined;
      this.#failStreak = 0;
    } catch (error) {
      if (error instanceof HttpStatusError && (error.status === 401 || error.status === 403)) {
        // The credential (which may be null on a secured server) is refused: report access needed and back
        // off on this exact credential until a different one arrives. Auth is a definite answer, not a
        // transient fault, so apply it at once and reset the fault streak.
        this.#state = 'needs-auth';
        this.#refusedCred = token;
        this.#failStreak = 0;
      } else {
        // A 5xx (reachable but faulting) or a transport fault (unreachable) can be a single blip on a
        // boat link. Debounce: only surface offline or error after COMPANION_FAIL_THRESHOLD consecutive
        // failures, keeping the last state through one dropped poll. Both keep polling so the pill
        // recovers on its own, and neither backs off a credential, since this is not an auth refusal.
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
