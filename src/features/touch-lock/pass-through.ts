// The surfaces that stay live while the screen is locked. The shield is built by geometry, so the
// contract is the rendered boxes of these selectors: every MOB key (the topbar's, and the
// full-screen instrument dock's while it is open) and the emergency rail holding the safety alert
// stack. The overlay re-queries them on every measure, so a surface that mounts while locked is
// still found; only its selector is fixed here.
export const DEFAULT_PASS_THROUGH_SELECTORS: readonly string[] = ['.mob-btn', '.safety-rail'];
