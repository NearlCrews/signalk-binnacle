<script lang="ts">
import { untrack } from 'svelte';
import uPlot, { type AlignedData } from 'uplot';
import { sameJsonValue } from '$shared/lib';
import type { Theme } from '$shared/ui';
import 'uplot/dist/uPlot.min.css';

interface Props {
  times: readonly number[];
  values: ReadonlyArray<number | null>;
  theme: Theme;
  onHoverIndex?: (index: number | undefined) => void;
}

const { times, values, theme, onHoverIndex }: Props = $props();

const CHART_HEIGHT = 120;
const YAXIS_SIZE = 52;
const FALLBACK_WIDTH = 280;

let host: HTMLDivElement | undefined = $state();
let chart = $state.raw<uPlot | undefined>();

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'currentColor';
}

function makeChart(el: HTMLDivElement, width: number): uPlot {
  const axis: uPlot.Axis = {
    stroke: () => cssVar('--text-muted'),
    grid: { stroke: () => cssVar('--border'), width: 1 },
    ticks: { stroke: () => cssVar('--border'), width: 1 },
  };
  return new uPlot(
    {
      width,
      height: CHART_HEIGHT,
      scales: { x: { time: true } },
      series: [
        {},
        {
          stroke: () => cssVar('--accent'),
          width: 2,
          spanGaps: false,
          points: { show: false },
        },
      ],
      axes: [axis, { ...axis, size: YAXIS_SIZE }],
      legend: { show: false },
      cursor: { show: true, points: { show: true } },
      hooks: {
        setCursor: [
          (plot) => {
            onHoverIndex?.(plot.cursor.idx ?? undefined);
          },
        ],
      },
    },
    [times as number[], values as (number | null)[]] as AlignedData,
    el,
  );
}

$effect(() => {
  const el = host;
  if (!el) return;
  // Data changes are handled by setData below. Keep them out of this lifecycle effect so a new
  // recorder sample updates the existing canvas instead of destroying and rebuilding uPlot.
  chart = untrack(() => makeChart(el, el.clientWidth || FALLBACK_WIDTH));
  const resize = new ResizeObserver(() => {
    if (chart && el.clientWidth > 0) {
      chart.setSize({ width: el.clientWidth, height: CHART_HEIGHT });
    }
  });
  resize.observe(el);
  return () => {
    resize.disconnect();
    chart?.destroy();
    chart = undefined;
  };
});

// The series arrays are rebuilt (mapped through the unit conversion) whenever anything upstream
// recomputes, so identity alone cannot tell a real new sample from the same data in a new array.
// uPlot redraws on every setData, so compare the values and skip the redundant ones.
let drawnTimes: readonly number[] | undefined;
let drawnValues: readonly (number | null)[] | undefined;
$effect(() => {
  const plot = chart;
  if (!plot) return;
  if (sameJsonValue(drawnTimes, times) && sameJsonValue(drawnValues, values)) return;
  // Recorded only alongside a real setData, so a change that lands between a teardown and the next
  // construction cannot mark itself drawn against a chart that never received it.
  drawnTimes = times;
  drawnValues = values;
  plot.setData([times as number[], values as (number | null)[]] as AlignedData);
});

$effect(() => {
  void theme;
  chart?.redraw(false, true);
});
</script>

<div class="trend-chart" bind:this={host} style:min-block-size="{CHART_HEIGHT}px"></div>

<style>
.trend-chart {
  min-inline-size: 0;
  inline-size: 100%;
  overflow: hidden;
}
.trend-chart :global(.u-wrap) {
  max-inline-size: 100%;
  color: var(--text-muted);
}
</style>
