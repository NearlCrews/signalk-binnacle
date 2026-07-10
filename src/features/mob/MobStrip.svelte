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
  // Set the Signal K course destination to the mark, the deliberate second tap (never automatic,
  // since a coupled autopilot may follow the course).
  onSteer: () => void;
  // Clear the mark: recovery complete, or an accidental trigger.
  onCancel: () => void;
}

const { mob, units, onSteer, onCancel }: Props = $props();

// Cancel wipes the splash point boat-wide, so it arms a confirm step instead of firing on a
// single tap; the arm times out back to plain Cancel on its own.
const cancelArm = new ConfirmArm();
onDestroy(() => cancelArm.disarm());

function tapCancel(): void {
  if (cancelArm.tap()) onCancel();
}
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
        <button type="button" class="ack ack--primary" disabled={!mob.position} onclick={onSteer}>
          Steer to MOB
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
  </aside>
{/if}
