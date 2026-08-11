<script lang="ts">
import type { ChartViewStatusKind } from '$shared/map';

// The compact ambient chart-trust indicator: whether a nautical chart actually covers the current
// view. Nonmodal, touch-sized, and always a route into Layers and charts for recovery.
interface Props {
  status: ChartViewStatusKind;
  onOpenLayers: () => void;
}

const { status, onOpenLayers }: Props = $props();

const COPY: Record<
  ChartViewStatusKind,
  { label: string; title: string; grade: 'ok' | 'warning' | 'alarm' }
> = {
  active: {
    label: 'Chart',
    title: 'A nautical chart covers this view. Tap to open Layers and charts.',
    grade: 'ok',
  },
  'active-overzoomed': {
    label: 'Chart overzoomed',
    title:
      'Zoomed past the chart’s native detail; shapes are stretched beyond what was surveyed. Tap to open Layers and charts.',
    grade: 'warning',
  },
  'reference-only': {
    label: 'Reference map only',
    title:
      'No nautical chart layer is enabled; this base map is for reference and is not a navigation chart. Tap to open Layers and charts.',
    grade: 'warning',
  },
  'out-of-coverage': {
    label: 'Outside chart coverage',
    title: 'The enabled nautical charts do not cover this view. Tap to open Layers and charts.',
    grade: 'warning',
  },
  'source-failed': {
    label: 'Chart source failed',
    title: 'The chart source could not be loaded. Tap to open Layers and charts and retry.',
    grade: 'alarm',
  },
  'base-unavailable': {
    label: 'Base map unavailable',
    title:
      'The base map style did not arrive; an offline fallback base is standing in. Cached charts still load. Tap to open Layers and charts.',
    grade: 'alarm',
  },
};

const copy = $derived(COPY[status]);
</script>

<button
  type="button"
  class="btn btn-pill chart-status"
  class:chart-status--warning={copy.grade === 'warning'}
  class:chart-status--alarm={copy.grade === 'alarm'}
  title={copy.title}
  aria-label={copy.title}
  onclick={onOpenLayers}
>
  {copy.label}
</button>

<style>
/* Bottom-leading corner on the shared --space-3 chrome gutter, lifted by the measured safety-rail
   clearance so a danger or MOB strip can never half-cover the chart-trust statement. The variable
   resolves to 0px while no alerts are up, and the badge stays below the strips in z. */
.chart-status {
  position: absolute;
  inset-block-end: calc(var(--space-3) + var(--rail-clearance, 0px));
  inset-inline-start: var(--space-3);
  z-index: var(--z-overlay);
  background: var(--surface-overlay);
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.chart-status--warning {
  color: var(--warning);
  border-color: var(--warning);
}
.chart-status--alarm {
  color: var(--alarm);
  border-color: var(--alarm);
}
</style>
