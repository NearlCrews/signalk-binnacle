<script lang="ts">
import type { ZoneState } from '$shared/signalk';
import type { TileReading } from './tile-catalog';

interface Props {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
}

const { label, reading, zone, sensorGloss }: Props = $props();
</script>

<div
  class="tile card-frame"
  class:tile--warning={zone === 'warning'}
  class:tile--alarm={zone === 'alarm'}
  class:tile--stale={reading.state === 'stale'}
>
  <span class="caps-label"
    >{label}{reading.referenceLabel ? ` (${reading.referenceLabel})` : ''}</span
  >
  {#if reading.state === 'never'}
    <span class="muted-note gloss">{sensorGloss}</span>
  {:else}
    <span class="value"
      ><span class="num">{reading.value}</span><span class="unit">{reading.unit}</span></span
    >
  {/if}
</div>

<style>
.tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-block-size: 5.5rem;
  padding: var(--space-2) var(--space-3);
}

.value .num {
  font-size: var(--text-readout);
}

.unit {
  color: var(--text-muted);
  font-size: var(--text-xs);
  margin-inline-start: var(--space-1);
}

.tile--warning {
  border-color: var(--warning);
  background: var(--warning-tint);
}

.tile--warning .num {
  color: var(--warning);
}

.tile--alarm {
  border-color: var(--alarm);
  background: var(--alarm-tint);
}

.tile--alarm .num {
  color: var(--alarm);
}

.tile--stale .num {
  color: var(--text-muted);
}
</style>
