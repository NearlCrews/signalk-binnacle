<script lang="ts">
import { formatSignedAngleOr, RAD_TO_DEG } from '$shared/lib';
import type { ZoneState } from '$shared/signalk';
import TileStateBadge from './TileStateBadge.svelte';
import { tileAccessibleLabel } from './tile-accessibility';
import type { TileReading } from './tile-catalog';

interface Props {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
  kind?: string;
  abbr?: string;
  // See NumericTile: the retained stale value's age, shown while the reading is stale.
  staleAgeText?: string;
  onOpen?: () => void;
}

const { label, reading, zone, sensorGloss, kind, abbr, staleAgeText, onOpen }: Props = $props();

// One expression, so the formatter cannot split the label from its reference parenthetical.
const labelText = $derived(
  `${label}${reading.referenceLabel ? ` (${reading.referenceLabel})` : ''}`,
);
const accessibleLabel = $derived(tileAccessibleLabel(labelText, reading, zone, sensorGloss));

// BOW-UP: 0 rad points up. SVG rotate() uses degrees, positive = clockwise.
const deg = $derived((reading.angleRad ?? 0) * RAD_TO_DEG);
</script>

<button
  type="button"
  class="tile card-frame"
  class:tile--warning={zone === 'warning'}
  class:tile--alarm={zone === 'alarm'}
  class:tile--stale={reading.state === 'stale'}
  class:tile--empty={reading.state === 'never'}
  class:tile--wide={kind === 'wind'}
  aria-label={accessibleLabel}
  onclick={onOpen}
>
  {#if reading.state === 'never'}
    <span class="value"><span class="muted-note">{sensorGloss}</span></span>
  {:else}
    <div class="wind-body">
      <svg class="rose" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <!-- The bow marker at 12 o'clock. A filled arrowhead rather than a fourth identical tick,
             so the rose says which way the boat is pointing without a legend. -->
        <polygon points="50,3 45.5,13 54.5,13" fill="var(--text-muted)" />
        <!-- 3 major quarter ticks: starboard beam, stern, port beam -->
        <line
          x1="94"
          y1="50"
          x2="84"
          y2="50"
          stroke="var(--text-muted)"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
        <line
          x1="50"
          y1="94"
          x2="50"
          y2="84"
          stroke="var(--text-muted)"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
        <line
          x1="6"
          y1="50"
          x2="16"
          y2="50"
          stroke="var(--text-muted)"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
        <!-- 4 minor ticks on the 45s -->
        <line
          x1="81"
          y1="19"
          x2="75"
          y2="25"
          stroke="var(--text-muted)"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
        <line
          x1="81"
          y1="81"
          x2="75"
          y2="75"
          stroke="var(--text-muted)"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
        <line
          x1="19"
          y1="81"
          x2="25"
          y2="75"
          stroke="var(--text-muted)"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
        <line
          x1="19"
          y1="19"
          x2="25"
          y2="25"
          stroke="var(--text-muted)"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
        <!-- Needle: points up at 0 rad (bow-up); rotate by wind angle around center -->
        {#if typeof reading.angleRad === 'number'}
          <line
            class="needle"
            x1="50"
            y1="14"
            x2="50"
            y2="58"
            stroke="var(--accent)"
            stroke-width="2.5"
            stroke-linecap="round"
            transform="rotate({deg} 50 50)"
          />
        {/if}
      </svg>
      <span class="speed">
        <span class="num">{reading.value}</span><span class="unit">{reading.unit}</span
        ><span class="angle">{formatSignedAngleOr(reading.angleRad)}</span>
      </span>
    </div>
    {#if staleAgeText}
      <span class="tile-secondary">{staleAgeText}</span>
    {:else if reading.secondary}
      <span class="tile-secondary">{reading.secondary}</span>
    {/if}
  {/if}
  <!-- The abbreviation leads and carries the loud voice, matching NumericTile. -->
  <span class="caps-label"
    >{#if abbr}
      <span class="abbr">{abbr}</span>
    {/if}
    {labelText}</span
  >
  <!-- The angle freshness folds into the one badge line: the needle is already gone, and the
       badge names why, so a live speed beside a missing angle never reads as a broken display. -->
  <TileStateBadge state={reading.state} {zone} angleState={reading.angleState} />
</button>

<!-- The tile column, value size, unit, and zone tints come from the global .tile vocabulary in
     styles/instruments.css, shared with NumericTile; only the rose and the angle text are local. -->
<style>
.rose {
  inline-size: 3rem;
  block-size: 3rem;
  flex-shrink: 0;
}

.wind-body {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* One step above the unit size: the wind angle is operational helm data, not a suffix. */
.angle {
  color: var(--text-muted);
  font-size: var(--text-sm);
  margin-inline-start: var(--space-2);
}

.tile--stale .needle {
  stroke: var(--text-muted);
}
</style>
