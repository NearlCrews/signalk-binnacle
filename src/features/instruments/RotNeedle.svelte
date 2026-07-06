<script lang="ts">
import { RAD_PER_SEC_TO_DEG_PER_MIN } from './tile-catalog';

interface Props {
  radPerSec: number | undefined;
  maxDegPerMin?: number;
}

const { radPerSec, maxDegPerMin = 30 }: Props = $props();

// Needle angle in SVG degrees (positive = clockwise = starboard turn). Convert rad/s to deg/min,
// scale against the full-scale rate, clamp to +/-1, and open the needle up to +/-60 from vertical.
const rotation = $derived.by(() => {
  if (radPerSec === undefined) return undefined;
  const degPerMin = radPerSec * RAD_PER_SEC_TO_DEG_PER_MIN;
  return Math.max(-1, Math.min(1, degPerMin / maxDegPerMin)) * 60;
});
</script>

<svg class="rot" viewBox="0 0 40 22" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <path d="M 4 20 A 16 16 0 0 1 36 20" fill="none" stroke="currentColor" stroke-width="1.5" />
  <line x1="20" y1="4" x2="20" y2="8" stroke="currentColor" stroke-width="1.5" />
  {#if rotation !== undefined}
    <line
      class="needle"
      x1="20"
      y1="20"
      x2="20"
      y2="6"
      stroke="var(--accent)"
      stroke-width="2"
      stroke-linecap="round"
      transform="rotate({rotation} 20 20)"
    />
  {/if}
</svg>

<style>
.rot {
  inline-size: 2.5rem;
  block-size: auto;
  flex-shrink: 0;
}
</style>
