<script lang="ts">
import { onDestroy } from 'svelte';
import type { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import { formatLengthOr, lengthUnit } from '$shared/lib';
import { ConfirmArm } from '$shared/ui';

interface Props {
  anchor: AnchorWatch;
  units: UnitsStore;
  onRaise: () => void;
}

const { anchor, units, onRaise }: Props = $props();

// Raise ends the watch and silences the alarm in one motion, so it arms a confirm step instead
// of firing on a single tap; the arm times out back to plain Raise on its own.
const raiseArm = new ConfirmArm();
onDestroy(() => raiseArm.disarm());

function tapRaise(): void {
  if (raiseArm.tap()) onRaise();
}

// A client watch that has lost its fix gets the same first-class strip as a drag: its drag
// detection is dead, which the sleeping crew must be able to acknowledge or act on. A drag
// outranks it for the title, and each condition carries its own acknowledged state (the drag
// acknowledge is server-graded, the fix-lost one per episode).
const fixLost = $derived(anchor.degradedCause === 'fix-lost');
const acked = $derived(anchor.dragging ? anchor.acknowledged : anchor.fixLostAcknowledged);
</script>

{#if anchor.dragging || fixLost}
  <!-- No aria-live here: App owns the assertive anchor channel (a concise spoken summary in a
       persistent role=alert region), mirroring the collision strip's split. -->
  <aside class="bottom-strip bottom-strip--alarm" class:is-ack={acked} aria-label="Anchor alarm">
    <div class="head">
      <span class="title">{anchor.dragging ? 'Anchor dragging' : 'Anchor watch: no GPS'}</span>
      {#if acked}
        <span class="note ack-tag">Acknowledged</span>
      {:else}
        <div class="actions actions--safety">
          <!-- Before the fix-lost tone arms there is nothing to acknowledge, and a tap here must
               not silently disarm the alarm the grace is still counting toward. -->
          <button
            type="button"
            class="ack"
            disabled={!anchor.dragging && !anchor.fixLostAlarm}
            onclick={() => anchor.acknowledge()}
          >
            Acknowledge
          </button>
          <button type="button" class="ack ack--warning" onclick={tapRaise}>
            {raiseArm.armed ? 'Confirm raise?' : 'Raise anchor'}
          </button>
        </div>
      {/if}
    </div>
    <div class="row">
      <span class="metric">
        Off anchor <b>{formatLengthOr(anchor.distanceMeters, units.mode, 0)}</b>
        {lengthUnit(units.mode)}
      </span>
      <span class="metric">
        Radius <b>{formatLengthOr(anchor.radiusMeters, units.mode, 0)}</b>
        {lengthUnit(units.mode)}
      </span>
    </div>
  </aside>
{/if}
