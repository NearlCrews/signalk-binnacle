<script lang="ts">
import type { ZoneState } from '$shared/signalk';
import BatteryBar from './BatteryBar.svelte';
import RotNeedle from './RotNeedle.svelte';
import Sparkline from './Sparkline.svelte';
import TileStateBadge from './TileStateBadge.svelte';
import { tileAccessibleLabel } from './tile-accessibility';
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
  // The retained stale value's age, shown in place of the secondary line while stale, so the
  // muted numeral carries the fact that makes retention honest.
  staleAgeText?: string;
  onOpen?: () => void;
}

const {
  label,
  reading,
  zone,
  sensorGloss,
  kind,
  abbr,
  viz,
  sparkPoints,
  staleAgeText,
  onOpen,
}: Props = $props();

// One expression, so the formatter cannot split the label from its reference parenthetical.
const labelText = $derived(
  `${label}${reading.referenceLabel ? ` (${reading.referenceLabel})` : ''}`,
);
const accessibleLabel = $derived(tileAccessibleLabel(labelText, reading, zone, sensorGloss));
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
  aria-label={accessibleLabel}
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
    {#if staleAgeText}
      <span class="tile-secondary">{staleAgeText}</span>
    {:else if reading.secondary}
      <span class="tile-secondary">{reading.secondary}</span>
    {/if}
  {/if}
  <!-- The abbreviation leads and carries the loud voice: a mariner scans for SOG or HDG, not for
       the long name, which stays as the quiet gloss beside it. -->
  <span class="caps-label"
    >{#if abbr}
      <span class="abbr">{abbr}</span>
    {/if}
    {labelText}</span
  >
  <TileStateBadge state={reading.state} {zone} />
</button>
