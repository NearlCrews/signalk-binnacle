<script lang="ts">
import { onDestroy } from 'svelte';
import type { MobStore } from '$entities/mob';
import type { UnitsStore } from '$entities/units';
import { formatBearingOr, formatClockTime, formatMetersOrNm } from '$shared/lib';
import { ConfirmArm } from '$shared/ui';
import { formatElapsed } from './mob-format';

interface Props {
  mob: MobStore;
  units: UnitsStore;
  // The controller's warning that the boat-wide announcement may not have reached the server, so
  // the crew never believes every station alarmed when only this display did.
  publishWarning?: string;
  // The name of the destination the vessel is currently navigating to, when a course is active,
  // so the steer confirmation can say what it replaces.
  activeCourse?: string;
  // Set the Signal K course destination to the mark, the deliberate second tap (never automatic,
  // since a coupled autopilot may follow the course).
  onSteer: () => void;
  // Clear the mark: recovery complete, or an accidental trigger.
  onCancel: () => void;
}

const { mob, units, publishWarning, activeCourse, onSteer, onCancel }: Props = $props();

// Cancel wipes the splash point boat-wide, so it arms a confirm step instead of firing on a
// single tap; the arm times out back to plain Cancel on its own.
const cancelArm = new ConfirmArm();
// Steer replaces the active course in one navigation command a coupled autopilot may follow, so
// it arms the same way: the first tap explains, only the second commits.
const steerArm = new ConfirmArm();
onDestroy(() => {
  cancelArm.disarm();
  steerArm.disarm();
});

function tapCancel(): void {
  if (cancelArm.tap()) onCancel();
}

function tapSteer(): void {
  if (steerArm.tap()) onSteer();
}

function disarmSteerOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && steerArm.armed) {
    event.stopPropagation();
    steerArm.disarm();
  }
}

// A steer armed against a position that has since been lost, or against a navigation state that
// changed under it, is confirming a different action than the one explained: disarm.
$effect(() => {
  if (!mob.position) steerArm.disarm();
});
let lastCourse: string | undefined;
$effect(() => {
  if (activeCourse !== lastCourse) steerArm.disarm();
  lastCourse = activeCourse;
});

const steerWarning = $derived(
  activeCourse === undefined
    ? 'Sets the course to the MOB mark. A coupled autopilot may turn.'
    : `Replaces navigation to ${activeCourse} with the MOB mark. A coupled autopilot may turn.`,
);
</script>

{#if mob.active}
  <!-- No aria-live here: App owns the assertive MOB channel, mirroring the collision split. -->
  <aside
    class="bottom-strip bottom-strip--alarm"
    class:is-ack={mob.acknowledged}
    aria-label="Man overboard"
  >
    <div class="head">
      <span class="title">Man overboard</span>
      {#if mob.acknowledged}
        <span class="note ack-tag">Acknowledged</span>
      {/if}
      <div class="actions actions--safety">
        <button
          type="button"
          class="ack ack--primary"
          disabled={!mob.position}
          onclick={tapSteer}
          onkeydown={disarmSteerOnEscape}
        >
          {steerArm.armed ? 'Confirm steer?' : 'Steer to MOB'}
        </button>
        {#if !mob.acknowledged}
          <button type="button" class="ack" onclick={() => mob.acknowledge()}>Acknowledge</button>
        {/if}
        <button type="button" class="ack ack--warning" onclick={tapCancel}>
          {cancelArm.armed ? 'Confirm cancel?' : 'Cancel'}
        </button>
      </div>
    </div>
    <div class="row">
      <span class="metric">Bearing <b>{formatBearingOr(mob.bearingRad)}</b>&deg;T</span>
      <span class="metric">Range <b>{formatMetersOrNm(mob.distanceMeters, units.mode)}</b></span>
      {#if mob.elapsedSeconds !== undefined}
        <span class="metric">Elapsed <b>{formatElapsed(mob.elapsedSeconds)}</b></span>
      {/if}
      <!-- The wall-clock mark time: what goes in the log and out on the VHF relay, so a stressed
           skipper never does clock arithmetic from elapsed. -->
      {#if mob.markEpochMs !== undefined}
        <span class="metric"
          >Marked <b>{formatClockTime(mob.markEpochMs, { seconds: true })}</b></span
        >
      {/if}
    </div>
    {#if steerArm.armed}
      <!-- Polite, not assertive: the armed explanation must not restart the MOB announcement. -->
      <div class="row">
        <span class="alert-note" role="status">{steerWarning}</span>
      </div>
    {/if}
    {#if publishWarning}
      <!-- Polite, not assertive: the MOB channel already holds the assertive region, and this
           caveat must not restart the bearing-and-range announcement. -->
      <div class="row">
        <span class="alert-note" role="status">{publishWarning}</span>
      </div>
    {/if}
  </aside>
{/if}
