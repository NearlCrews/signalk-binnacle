<script lang="ts">
import type { UnitsStore } from '$entities/units';
import { DEPTH_SOURCE_TITLES } from '$entities/vessel';
import { formatLengthOr, lengthUnit } from '$shared/lib';
import type { ShallowAlarmView } from './shallow-monitor.svelte';

interface Props {
  shallow: ShallowAlarmView;
  units: UnitsStore;
  // Called after Acknowledge, so the rail can keep focus if another condition replaces this strip.
  onAcknowledged?: () => void;
}

const { shallow, units, onAcknowledged }: Props = $props();
const unit = $derived(lengthUnit(units.mode));
let strip = $state<HTMLElement | undefined>();

// Acknowledge removes its own button, so keep keyboard focus on the strip rather than letting it
// fall to the page.
function acknowledge(): void {
  shallow.acknowledge();
  strip?.focus();
  onAcknowledged?.();
}
</script>

{#if shallow.alarming}
  <!-- No aria-live here: App owns the safety live region, which already speaks the depth and the
       threshold that fired. -->
  <aside
    bind:this={strip}
    class="bottom-strip bottom-strip--alarm"
    class:is-ack={shallow.acknowledged}
    aria-label="Shallow water"
    tabindex="-1"
  >
    <div class="head">
      <span class="title">Shallow water</span>
      {#if shallow.acknowledged}
        <span class="note ack-tag">Acknowledged</span>
      {:else}
        <div class="actions actions--safety">
          <button type="button" class="btn btn-pill btn-strip" onclick={acknowledge}>
            Acknowledge
          </button>
        </div>
      {/if}
    </div>
    <div class="row">
      <span class="metric"
        >Depth <b>{formatLengthOr(shallow.depthMeters, units.mode)}</b> {unit}</span
      >
      {#if shallow.insideServerZone}
        <span class="note">Inside the server's depth alarm zone</span>
      {:else}
        <span class="metric"
          >Limit <b>{formatLengthOr(shallow.effectiveLimitMeters, units.mode)}</b> {unit}</span
        >
      {/if}
      {#if shallow.depthSource}
        <span class="note">{DEPTH_SOURCE_TITLES[shallow.depthSource]}</span>
      {/if}
    </div>
    {#if shallow.acknowledged &&
      shallow.rearmBelowMeters !== undefined &&
      shallow.rearmBelowMeters > 0}
      <p class="note rearm">
        Sounds again below {formatLengthOr(shallow.rearmBelowMeters, units.mode)} {unit}.
      </p>
    {/if}
  </aside>
{/if}

<style>
.rearm {
  margin: 0.3rem 0 0;
}
</style>
