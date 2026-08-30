import type { OwnVessel } from '$entities/vessel';
import type { LonLat } from '$shared/geo';
import { prefersReducedMotion } from '$shared/lib';
import { blendLonLat, haversineMeters, MOTION_SNAP_METERS } from '$shared/nav';
import type { MapCommands } from '$widgets/chart-canvas';

// How long the camera takes to glide onto a fresh fix, sized to the ~1 Hz position cadence with
// linear easing: each fix restarts the glide at roughly the same chase velocity, so consecutive
// glides chain into continuous motion instead of a per-fix snap.
const FOLLOW_EASE_MS = 1_000;

// Frame scheduling, the clock, and the reduced-motion preference, injectable for tests.
interface FollowMotion {
  schedule(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
  now(): number;
  reducedMotion(): boolean;
}

interface FollowControllerDeps {
  vessel: Pick<OwnVessel, 'position' | 'positionStale'>;
  commands: () => Pick<MapCommands, 'recenterOnVessel'> | undefined;
  // The bounded look-ahead in pixels, 0 for none. Injected as a getter so a rotated chart making
  // way shifts the boat low on screen and the water ahead gets the pixels, while north-up or a
  // stopped boat stays centered.
  lookAheadPx?: () => number;
  motion?: Partial<FollowMotion>;
}

// Follow lock: while on, the map chases the boat as each fix arrives, gliding between fixes so the
// chart reads as continuous motion. A manual pan releases it, and it does not persist across
// reloads. A stale fix only pauses recentering: follow stays armed through a GPS outage (bridges,
// enclosed harbors, tall structures) and resumes on the next fresh fix, instead of silently
// disarming at the moment the navigator most needs chart tracking.
export function createFollowController(deps: FollowControllerDeps) {
  let following = $state(false);
  const canGlide =
    deps.motion?.schedule !== undefined || typeof requestAnimationFrame === 'function';
  const motion: FollowMotion = {
    schedule: deps.motion?.schedule ?? ((callback) => requestAnimationFrame(callback)),
    cancel: deps.motion?.cancel ?? ((handle) => cancelAnimationFrame(handle)),
    now: deps.motion?.now ?? (() => performance.now()),
    reducedMotion: deps.motion?.reducedMotion ?? prefersReducedMotion,
  };

  // The last center this controller commanded, [longitude, latitude]. The map's actual center is
  // not readable through the recenter command, so the glide eases from here; while follow is on and
  // the user is not interacting the two agree. Undefined until the first recenter (and again after
  // release), so an enable jumps to the boat rather than gliding in from an unknown center.
  let commanded: LonLat | undefined;
  let glideHandle: number | undefined;
  let glideFrom: LonLat = [0, 0];
  let glideToLat = 0;
  let glideToLon = 0;
  let glideStartMs = 0;

  function recenter(latitude: number, longitude: number): void {
    const commands = deps.commands();
    if (!commands) return;
    commands.recenterOnVessel(latitude, longitude, deps.lookAheadPx?.() ?? 0);
    commanded = [longitude, latitude];
  }

  function stopGlide(): void {
    if (glideHandle === undefined) return;
    motion.cancel(glideHandle);
    glideHandle = undefined;
  }

  function glideFrame(nowMs: number): void {
    glideHandle = undefined;
    if (!following) return;
    const fraction = (nowMs - glideStartMs) / FOLLOW_EASE_MS;
    if (fraction >= 1) {
      recenter(glideToLat, glideToLon);
      return;
    }
    const point = blendLonLat(glideFrom, [glideToLon, glideToLat], fraction);
    recenter(point[1], point[0]);
    glideHandle = motion.schedule(glideFrame);
  }

  function moveTo(latitude: number, longitude: number): void {
    stopGlide();
    const from = commanded;
    if (from && from[1] === latitude && from[0] === longitude) return;
    if (!from || !canGlide || motion.reducedMotion()) {
      recenter(latitude, longitude);
      return;
    }
    // A jump past the plausibility bound teleports honestly instead of gliding the chart through
    // water the boat never crossed.
    if (haversineMeters(from[1], from[0], latitude, longitude) > MOTION_SNAP_METERS) {
      recenter(latitude, longitude);
      return;
    }
    glideFrom = from;
    glideToLat = latitude;
    glideToLon = longitude;
    glideStartMs = motion.now();
    glideHandle = motion.schedule(glideFrame);
  }

  $effect(() => {
    if (!following) {
      stopGlide();
      commanded = undefined;
      return;
    }
    const position = deps.vessel.position;
    if (!position || deps.vessel.positionStale) return;
    if (!deps.commands()) return;
    // Read (and track) the look-ahead so an orientation change recenters under the new offset
    // without waiting for the next fix; the glide frames re-read it live through recenter.
    deps.lookAheadPx?.();
    moveTo(position.latitude, position.longitude);
  });

  // Runs once; its cleanup fires only at root disposal, so a pending glide frame cannot outlive
  // the owning component. The chasing effect above must not carry this cleanup itself: it re-runs
  // per fix, and canceling there would kill every glide at its first frame.
  $effect(() => () => stopGlide());

  return {
    get following() {
      return following;
    },
    toggle(): void {
      following = !following;
    },
    release(): void {
      following = false;
    },
  };
}
