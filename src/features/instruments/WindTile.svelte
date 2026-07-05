<script lang="ts">
import { formatSignedAngleOr } from '$shared/lib';
import type { ZoneState } from '$shared/signalk';
import type { TileReading } from './tile-catalog';

interface Props {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
  kind?: string;
  abbr?: string;
}

const { label, reading, zone, sensorGloss, kind, abbr }: Props = $props();

// One expression, so the formatter cannot split the label from its reference parenthetical.
const labelText = $derived(
  `${label}${reading.referenceLabel ? ` (${reading.referenceLabel})` : ''}`,
);

// BOW-UP: 0 rad points up. SVG rotate() uses degrees, positive = clockwise.
const deg = $derived((reading.angleRad ?? 0) * (180 / Math.PI));
</script>

<div
  class="tile card-frame"
  class:tile--warning={zone === 'warning'}
  class:tile--alarm={zone === 'alarm'}
  class:tile--stale={reading.state === 'stale'}
  class:tile--empty={reading.state === 'never'}
  class:tile--wide={kind === 'wind'}
>
  <span class="caps-label"
    >{labelText}
    {#if abbr}
      <span class="abbr">{abbr}</span>
    {/if}</span
  >
  {#if reading.state === 'never'}
    <span class="muted-note">{sensorGloss}</span>
  {:else}
    <div class="wind-body">
      <svg class="rose" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <!-- 4 major cardinal ticks: N, E, S, W -->
        <line x1="50" y1="6" x2="50" y2="16" stroke="var(--text-muted)" stroke-width="2" />
        <line x1="94" y1="50" x2="84" y2="50" stroke="var(--text-muted)" stroke-width="2" />
        <line x1="50" y1="94" x2="50" y2="84" stroke="var(--text-muted)" stroke-width="2" />
        <line x1="6" y1="50" x2="16" y2="50" stroke="var(--text-muted)" stroke-width="2" />
        <!-- 4 minor intercardinal ticks: NE, SE, SW, NW -->
        <line x1="81" y1="19" x2="75" y2="25" stroke="var(--text-muted)" stroke-width="1.5" />
        <line x1="81" y1="81" x2="75" y2="75" stroke="var(--text-muted)" stroke-width="1.5" />
        <line x1="19" y1="81" x2="25" y2="75" stroke="var(--text-muted)" stroke-width="1.5" />
        <line x1="19" y1="19" x2="25" y2="25" stroke="var(--text-muted)" stroke-width="1.5" />
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
  {/if}
</div>

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

.angle {
  color: var(--text-muted);
  font-size: var(--text-xs);
  margin-inline-start: var(--space-2);
}

.tile--stale .needle {
  stroke: var(--text-muted);
}
</style>
