<script lang="ts">
interface Props {
  points: number[];
  label?: string;
}

const { points, label }: Props = $props();

// The polyline point string, or null when there is too little history to draw a line. Built here so
// the template stays declarative and the y math lives in one place.
const polyline = $derived.by(() => {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  return points
    .map((value, i) => {
      const x = (i / (points.length - 1)) * 100;
      // Invert y (SVG y grows downward) and pad 2px each end: min maps to 22 (bottom), max to 2
      // (top). A flat series has no span, so pin every point to the vertical midline.
      const y = span === 0 ? 12 : 22 - ((value - min) / span) * 20;
      return `${x},${y}`;
    })
    .join(' ');
});
</script>

{#if polyline}
  <svg
    class="sparkline"
    viewBox="0 0 100 24"
    preserveAspectRatio="none"
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : 'true'}
    xmlns="http://www.w3.org/2000/svg"
  >
    <polyline
      points={polyline}
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{/if}

<style>
.sparkline {
  inline-size: 100%;
  block-size: 1.25rem;
  /* Muted so the trace reads as background context under the hero readout, not a competing element. */
  opacity: 0.5;
}
</style>
