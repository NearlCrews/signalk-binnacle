import { MINUTE_MS } from '$shared/lib';

// How long an AIS target may go without an update before it is pruned from the store
// (store.pruneAis). Anchored Class A and slow Class B vessels nominally report every 3 minutes,
// so a TTL at that interval flaps anchored traffic off and on; 7 minutes tolerates two missed
// slow-rate reports before a target is treated as gone.
export const AIS_STALE_TTL_MS = 7 * MINUTE_MS;

// Staleness changes on a minutes scale, so prune on this coarse cadence, and from a timer rather
// than the render path: rendering pauses in a hidden tab while the collision math keeps consuming
// the store, so an expiry tied to rendering would feed it stale targets.
export const AIS_PRUNE_INTERVAL_MS = 5_000;

// A provider's CPA and TCPA are one safety assertion and expire together. They are derived from
// both vessels' motion, so keeping them for the full slow-target TTL would present obsolete risk
// long after either vessel changed course.
export const AIS_APPROACH_STALE_TTL_MS = 30_000;

// Motion drives local CPA projection and must age out much sooner than the target's slow-reporting
// position. Class B targets can report at 30-second intervals, so leave one interval of margin for
// delivery jitter without retaining a velocity vector through multiple missed reports.
export const AIS_MOTION_STALE_TTL_MS = 60_000;

// The floor for how often a rendered view of the traffic is rebuilt. A rendered position does not
// need better than about 1 Hz, and a glanceable list needs it less. Declared here with the other
// AIS timings so the overlays and the list cannot be tuned apart, which a comment in each feature
// asserting they agree would not prevent.
export const AIS_REFRESH_MIN_MS = 1_000;
