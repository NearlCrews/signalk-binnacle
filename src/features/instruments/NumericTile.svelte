<script lang="ts">
import type { ZoneState } from '$shared/signalk';
import BatteryBar from './BatteryBar.svelte';
import RotNeedle from './RotNeedle.svelte';
import Sparkline from './Sparkline.svelte';
import type { TileDef, TileReading } from './tile-catalog';

interface Props {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
  kind?: string;
  abbr?: string;
  viz?: TileDef['viz'];
  sparkPoints?: number[];
  onOpen?: () => void;
}

const { label, reading, zone, sensorGloss, kind, abbr, viz, sparkPoints, onOpen }: Props = $props();

// One expression, so the formatter cannot split the label from its reference parenthetical.
const labelText = $derived(
  `${label}${reading.referenceLabel ? ` (${reading.referenceLabel})` : ''}`,
);
</script>

<!-- The tile column, value size, unit, and zone tints come from the global .tile vocabulary in
     styles/instruments.css, shared with WindTile. -->
<button
  type="button"
  class="tile card-frame"
  class:tile--warning={zone === 'warning'}
  class:tile--alarm={zone === 'alarm'}
  class:tile--stale={reading.state === 'stale'}
  class:tile--empty={reading.state === 'never'}
  class:tile--position={kind === 'position'}
  aria-label={`Open ${labelText} details`}
  onclick={onOpen}
>
  {#if reading.state === 'never'}
    <span class="value"><span class="muted-note">{sensorGloss}</span></span>
  {:else}
    <span class="value"
      ><span class="num">{reading.value}</span><span class="unit">{reading.unit}</span></span
    >
    {#if viz === 'battery'}
      <BatteryBar fraction={reading.siValue} state={zone} />
    {:else if viz === 'rot'}
      <RotNeedle radPerSec={reading.siValue} />
    {:else if sparkPoints}
      <Sparkline points={sparkPoints} />
    {/if}
    {#if reading.secondary}
      <span class="tile-secondary">{reading.secondary}</span>
    {/if}
  {/if}
  <span class="caps-label"
    >{labelText}
    {#if abbr}
      <span class="abbr">{abbr}</span>
    {/if}</span
  >
</button>
