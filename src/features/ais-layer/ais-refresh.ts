import { AIS_REFRESH_MIN_MS, type AisTargets } from '$entities/ais';

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
  let lastList: ReturnType<AisTargets['all']> | undefined;
  let lastRefreshAt = Number.NEGATIVE_INFINITY;
  return {
    reset() {
      lastVersion = -1;
      lastCount = -1;
      lastList = undefined;
      lastRefreshAt = Number.NEGATIVE_INFINITY;
    },
    shouldRefresh(force = false) {
      const version = targets.version;
      // The full chart-visible set, so a first navigation aid or SAR target paints immediately
      // rather than waiting out the throttle window behind an unchanged vessel count.
      const list = targets.all();
      // AisTargets retains a stable cached array until either the store version changes or one of
      // its clock-based freshness boundaries passes. A fresh array at the same version therefore
      // means a position, approach, or motion field expired and the rendered source must catch up.
      const clockExpiry = version === lastVersion && list !== lastList;
      if (!force && version === lastVersion && !clockExpiry) return false;
      const count = list.length;
      const refreshAt = now();
      if (
        !force &&
        !clockExpiry &&
        count === lastCount &&
        refreshAt - lastRefreshAt < AIS_REFRESH_MIN_MS
      ) {
        return false;
      }
      lastVersion = version;
      lastCount = count;
      lastList = list;
      lastRefreshAt = refreshAt;
      return true;
    },
  };
}
