import type { AisTargets } from '$entities/ais';

// Steady-state AIS churn (a position in nearly every worker flush) advances targets.version
// several times per second in a busy anchorage, and each advance used to rebuild the whole
// feature collection and push setData. Rendered positions do not need better than about 1 Hz,
// so version-only churn is held to this floor.
const AIS_REFRESH_MIN_MS = 1_000;

interface AisRefreshGate {
  reset(): void;
  shouldRefresh(force?: boolean): boolean;
}

// The shared change gate for the AIS overlays: a change in the rendered target count (a new
// contact, a pruned ghost) or a forced call (a severity flip) paints immediately, while
// version-only churn is throttled to AIS_REFRESH_MIN_MS. Clock-based, no timer, so a removed
// overlay costs nothing; the resting sync cadence delivers the trailing refresh.
export function createAisRefreshGate(targets: AisTargets, now: () => number): AisRefreshGate {
  let lastVersion = -1;
  let lastCount = -1;
  let lastRefreshAt = Number.NEGATIVE_INFINITY;
  return {
    reset() {
      lastVersion = -1;
      lastCount = -1;
      lastRefreshAt = Number.NEGATIVE_INFINITY;
    },
    shouldRefresh(force = false) {
      const version = targets.version;
      if (!force && version === lastVersion) return false;
      const count = targets.list().length;
      if (!force && count === lastCount && now() - lastRefreshAt < AIS_REFRESH_MIN_MS) {
        return false;
      }
      lastVersion = version;
      lastCount = count;
      lastRefreshAt = now();
      return true;
    },
  };
}
