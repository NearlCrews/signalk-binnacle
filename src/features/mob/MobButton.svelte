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
/* The helm's hardware convention: a solid red MOB key. Solid alarm fill appears nowhere else in
   the chrome (alarm surfaces speak in tints and borders), so the filled pill uniquely means MOB
   rather than crying alarm. Active (fly-to-mark) adds an inset contrast ring on the same fill, so
   the engaged state never reads dimmer than rest. */
.mob-btn {
  border-color: var(--alarm);
  background: var(--alarm);
  color: var(--alarm-contrast);
  font-weight: 700;
}
.mob-btn.is-on {
  background: var(--alarm);
  box-shadow: inset 0 0 0 2px var(--alarm-contrast);
}
/* Night brightness discipline: with no mark active the resting key drops to the tinted plane with
   warning-brightness text, a brightness borrow inside the red band, not a semantic reuse; the full
   alarm fill is reserved for an active mark, so the brightest pixel at night is only ever a live
   emergency. */
:global(:root[data-theme="night-red"]) .mob-btn {
  border-color: var(--warning);
  background: var(--alarm-tint-strong);
  color: var(--warning);
}
:global(:root[data-theme="night-red"]) .mob-btn.is-on {
  border-color: var(--alarm);
  background: var(--alarm);
  color: var(--alarm-contrast);
  box-shadow: none;
}
</style>
