<script lang="ts">
import LifeBuoy from '@lucide/svelte/icons/life-buoy';
import type { MobMark, MobStore } from '$entities/mob';
import type { LatLon } from '$shared/geo';
import { MINUTE_MS } from '$shared/lib';
import MobConfirmDialog from './MobConfirmDialog.svelte';

interface Props {
  mob: MobStore;
  // Server writes are known to be blocked; the confirm dialog qualifies its every-station promise.
  writeBlocked?: boolean;
  // The confirmed trigger: the app commits the mark, publishes the boat-wide alarm, and flies to it.
  onTrigger: (mark: MobMark | undefined) => void;
  // Fly the chart to the existing mark.
  onLocate: (position: LatLon) => void;
}

const { mob, writeBlocked = false, onTrigger, onLocate }: Props = $props();

// The MOB button must never trigger on a stray tap, so marking takes two: the button opens a
// centered confirm dialog, and only its Mark button commits. The fix is snapshotted at PRESS time,
// so the seconds spent confirming cannot carry the mark away from the person in the water.
let confirming = $state(false);
let pressMark = $state<MobMark | undefined>();

// A timed-out dialog keeps its press-time fix (see onTimeout), so a re-press shortly after reuses
// the earliest (closest to the splash point) fix instead of capturing one further downstream, as
// long as it is younger than this on the store's clock.
const REUSE_MAX_AGE_MS = MINUTE_MS;

// While a mark exists the button flies to it instead of re-marking, so a press cannot move the
// spot away from the person in the water; re-marking requires the strip's explicit Cancel first.
// Without a fix the button still opens the dialog: an MOB without a position is still an MOB.
function onButton(): void {
  const mark = mob.position;
  if (mark) {
    onLocate(mark);
    return;
  }
  const age = pressMark?.position ? mob.captureAgeMs(pressMark) : undefined;
  if (age === undefined || age >= REUSE_MAX_AGE_MS) pressMark = mob.capture();
  confirming = true;
}

function onConfirm(): void {
  confirming = false;
  // trigger() owns the fallback chain: a fix that arrived while the dialog was open is captured
  // there, and a press with a fix commits it untouched.
  onTrigger(pressMark);
  pressMark = undefined;
}

// An explicit Cancel is a statement of false alarm: discard the press-time fix completely.
function onCancel(): void {
  confirming = false;
  pressMark = undefined;
}

// A timeout is an abandoned dialog, not a retraction: retain a positioned fix for reuse.
function onTimeout(): void {
  confirming = false;
  if (!pressMark?.position) pressMark = undefined;
}
</script>

<button
  type="button"
  class="btn btn-pill mob-btn"
  class:is-on={mob.active}
  aria-pressed={mob.active}
  aria-haspopup={mob.position ? undefined : 'dialog'}
  aria-label={mob.position ? 'Fly to the man overboard mark' : 'Mark man overboard here'}
  title={mob.position
    ? 'Fly to the MOB mark'
    : 'Mark man overboard at the boat position (asks to confirm)'}
  onclick={onButton}
>
  <LifeBuoy size={16} aria-hidden="true" />
  MOB
</button>
{#if confirming}
  <MobConfirmDialog mark={pressMark} {writeBlocked} {onConfirm} {onCancel} {onTimeout} />
{/if}

<style>
/* The button reads as the emergency control it is: alarm-colored at rest, alarm-tinted while a
   mark is active (when it becomes fly-to-mark instead of re-marking). */
.mob-btn {
  color: var(--alarm);
  border-color: var(--alarm);
  font-weight: 600;
}
.mob-btn.is-on {
  background: var(--alarm-tint);
}
</style>
