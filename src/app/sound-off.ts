import type { AlarmAudioState } from '$shared/audio';

// Anything this display would be expected to sound for. A boat with none of these armed has no
// alarm to miss, so a blocked gate there is not worth a chip.
export interface ArmedWatches {
  anchorWatching: boolean;
  shallowMonitoring: boolean;
  aisTargets: number;
  routeActive: boolean;
  alarmRaised: boolean;
}

export function watchArmed(w: ArmedWatches): boolean {
  return (
    w.anchorWatching || w.shallowMonitoring || w.aisTargets > 0 || w.routeActive || w.alarmRaised
  );
}

// The gate state the strip's Sound off chip shows, or undefined to hide it.
export function soundOffState(state: AlarmAudioState, armed: boolean): AlarmAudioState | undefined {
  return armed && state !== 'ready' ? state : undefined;
}
