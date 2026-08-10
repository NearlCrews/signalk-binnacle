import type { AlarmTone } from '$shared/audio';

// A drag sounds until acknowledged. A fix-lost episode sounds too: the watch's degraded contract
// says a client watch without fixes is silently dead, and a sleeping crew cannot read a chip, so
// once the entity's grace judges the loss real the same tone carries it, with its own per-episode
// acknowledge.
export function shouldSoundAnchorAlarm(
  dragging: boolean,
  acknowledged: boolean,
  fixLostAlarm: boolean,
  fixLostAcknowledged: boolean,
): boolean {
  return (dragging && !acknowledged) || (fixLostAlarm && !fixLostAcknowledged);
}

// A three-beep burst, pitched between the urgent collision two-beep (880 Hz) and the calm arrival
// couplet (520 Hz), so a half-asleep navigator can tell which alarm woke them before reading a
// screen. The app sounds it through a GatedAlarm while a drag is active and not acknowledged.
export const ANCHOR_TONE: AlarmTone = {
  frequency: 660,
  beepMs: 150,
  gapMs: 100,
  beeps: 3,
  periodMs: 1600,
  volume: 0.18,
};
