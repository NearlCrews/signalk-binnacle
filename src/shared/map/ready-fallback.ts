// The bounded distrust of MapLibre 6's readiness bookkeeping: a vector source's loaded flag never
// flips, so the 'load' event never fires and isSourceLoaded stays false. themed-map bounds both
// its synthetic ready signal and its style-arrival watchdog with this; the sibling workaround,
// chart-overlay's native zoom cap, is purely event-driven (a timed fallback there would cap
// against MapLibre's constructor-default maxzoom). When either site is deleted against a fixed
// upstream release, check the sibling too, since they express one distrust.
export const MAPLIBRE_READY_FALLBACK_MS = 8000;

// The render-settle interval of themed-map's synthetic ready signal: initialization proceeds once
// no further render activity has happened for this long after styledata (mirrors 'idle' without
// trusting the broken loaded() check).
export const MAPLIBRE_READY_SETTLE_MS = 500;
