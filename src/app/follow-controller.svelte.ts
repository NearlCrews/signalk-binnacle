import type { OwnVessel } from '$entities/vessel';
import type { MapCommands } from '$widgets/chart-canvas';

interface FollowControllerDeps {
  vessel: Pick<OwnVessel, 'position' | 'positionStale'>;
  commands: () => Pick<MapCommands, 'recenterOnVessel'> | undefined;
  // The bounded look-ahead in pixels, 0 for none. Injected as a getter so a rotated chart making
  // way shifts the boat low on screen and the water ahead gets the pixels, while north-up or a
  // stopped boat stays centered.
  lookAheadPx?: () => number;
}

// Follow lock: while on, the map recenters on the boat as each fix arrives. A manual pan releases
// it, and it does not persist across reloads. A stale fix only pauses recentering: follow stays
// armed through a GPS outage (bridges, enclosed harbors, tall structures) and resumes on the next
// fresh fix, instead of silently disarming at the moment the navigator most needs chart tracking.
export function createFollowController(deps: FollowControllerDeps) {
  let following = $state(false);

  $effect(() => {
    if (!following) return;
    const position = deps.vessel.position;
    if (!position || deps.vessel.positionStale) return;
    deps
      .commands()
      ?.recenterOnVessel(position.latitude, position.longitude, deps.lookAheadPx?.() ?? 0);
  });

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
