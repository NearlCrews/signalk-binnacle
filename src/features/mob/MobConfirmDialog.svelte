<script lang="ts">
import LifeBuoy from '@lucide/svelte/icons/life-buoy';
import { onMount } from 'svelte';
import type { MobMark } from '$entities/mob';
import { formatClockTime, formatLatitude, formatLongitude } from '$shared/lib';
import { dialog, focusOnMount } from '$shared/ui';

interface Props {
  // The press-time capture; undefined when there was no GPS fix at the press.
  mark: MobMark | undefined;
  // Server writes are known to be blocked, so the every-station promise below must be qualified
  // before the tap, not discovered after it.
  writeBlocked?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  // Self-dismiss, distinct from onCancel so the opener can retain the press-time fix for a
  // re-press (a timeout is an abandoned dialog, a Cancel is a statement of false alarm).
  onTimeout: () => void;
}

const { mark, writeBlocked = false, onConfirm, onCancel, onTimeout }: Props = $props();

// Spoken and sighted halves of the dialog render these separately, so one constant keeps the
// screen reader and the sighted reader told the same thing.
const NO_FIX_NOTE = 'No GPS fix. The alarm will sound without a position.';
const WRITE_BLOCKED_NOTE =
  'Server write access is blocked, so other stations may not receive the alarm.';

// Generous for wet, gloved, one-handed taps on a pitching deck; press-time capture makes the wait
// free. The dialog still self-dismisses so an unattended accidental press can never leave a modal
// occluding a later alarm strip.
const TIMEOUT_S = 15;
let remaining = $state(TIMEOUT_S);
// Start the countdown on mount, not during setup, so the timer's life matches the committed DOM.
onMount(() => {
  const countdown = setInterval(() => {
    remaining -= 1;
    // Clear before firing so onTimeout runs exactly once: without this the interval keeps ticking
    // past zero and fires onTimeout every second until the opener happens to unmount the dialog.
    if (remaining <= 0) {
      clearInterval(countdown);
      onTimeout();
    }
  }, 1000);
  return () => clearInterval(countdown);
});

function confirm(): void {
  // Registration cue for a numb or gloved finger; the alarm tone follows from the trigger.
  navigator.vibrate?.(200);
  onConfirm();
}
</script>

<!-- The backdrop is natively handled by ::backdrop on the dialog, which is inert by default. -->
<!-- The host deliberately carries NO tabindex (unlike SlideOver): the dialog action's
     node.focus() then no-ops, so the confirm button's focusOnMount owns initial focus. -->
<dialog
  class="modal-card mob-dialog"
  role="alertdialog"
  aria-labelledby="mob-confirm-title"
  aria-describedby="mob-confirm-desc"
  use:dialog={onCancel}
>
  <header class="head">
    <LifeBuoy size={28} aria-hidden="true" />
    <h2 id="mob-confirm-title">Man overboard</h2>
  </header>
  <p id="mob-confirm-desc" class="desc">
    Marks the spot where MOB was pressed and sounds the alarm on every station.
    {#if mark?.position}
      <span class="visually-hidden">
        Captured {formatClockTime(mark.epochMs, { seconds: true })} at
        {formatLatitude(mark.position.latitude)}, {formatLongitude(mark.position.longitude)}.
      </span>
    {:else}
      <span class="visually-hidden">{NO_FIX_NOTE}</span>
    {/if}
    {#if writeBlocked}
      <span class="visually-hidden">{WRITE_BLOCKED_NOTE}</span>
    {/if}
  </p>
  {#if mark?.position}
    <p class="fix muted-note" aria-hidden="true">
      Captured {formatClockTime(mark.epochMs, { seconds: true })}<br>
      <span class="num">{formatLatitude(mark.position.latitude)}</span>
      <span class="num">{formatLongitude(mark.position.longitude)}</span>
    </p>
  {:else}
    <p class="fix muted-note no-fix" aria-hidden="true">{NO_FIX_NOTE}</p>
  {/if}
  {#if writeBlocked}
    <p class="fix muted-note dialog-warn" aria-hidden="true">{WRITE_BLOCKED_NOTE}</p>
  {/if}
  <div class="actions">
    <button type="button" class="btn" onclick={onCancel}>
      Cancel <span aria-hidden="true">({remaining}s)</span>
    </button>
    <button type="button" class="btn confirm" use:focusOnMount onclick={confirm}>
      <LifeBuoy size={20} aria-hidden="true" />
      Mark man overboard
    </button>
  </div>
</dialog>

<style>
.mob-dialog {
  inline-size: min(22rem, calc(100dvw - 2 * var(--space-4)));
  /* The alarm border is this dialog's modifier on top of the shared .modal-card frame. */
  border: 2px solid var(--alarm);
  /* Clips the header band to the radius. */
  overflow: hidden;
  animation: mob-dialog-in var(--transition-fast);
}
@keyframes mob-dialog-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mob-dialog {
    animation: none;
  }
}
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--alarm-tint);
  color: var(--alarm);
}
.head h2 {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 700;
}
.desc,
.fix {
  margin: 0;
  padding-inline: var(--space-4);
}
.desc {
  padding-block-start: var(--space-3);
  color: var(--text);
}
.fix {
  padding-block-start: var(--space-2);
}
.no-fix,
.dialog-warn {
  font-family: var(--font-ui);
  font-weight: 600;
  color: var(--warning);
}
/* Stacked, never side by side at equal size: the deadly miss is a panicked finger landing on
   Cancel when it meant Confirm. Cancel sits above, quiet and full-sized; the confirm is the
   dominant bottom element in the one-handed thumb zone. */
.actions {
  display: grid;
  row-gap: var(--space-3);
  padding: var(--space-4);
}
.actions .btn {
  font-size: var(--text-md);
}
/* The one tap in the app made with wet, gloved, shaking hands: 1.5x the normal touch target. */
.confirm {
  min-block-size: calc(var(--control-size) * 1.5);
  color: var(--alarm);
  border: 2px solid var(--alarm);
  background: var(--alarm-tint-strong);
  font-weight: 700;
}
.confirm:hover:not(:disabled) {
  filter: brightness(1.06);
}
</style>
