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
    <span class="muted-note">{sensorGloss}</span>
  {:else}
    <span class="value"
      ><span class="num">{reading.value}</span><span class="unit">{reading.unit}</span></span
    >
  {/if}
</div>

<!-- The tile column, value size, unit, and zone tints come from the global .tile vocabulary in
     styles/instruments.css, shared with WindTile. -->