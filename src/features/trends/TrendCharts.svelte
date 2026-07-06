<script lang="ts">
import {
  formatClockTime,
  formatFixed,
  lengthUnit,
  metersPerSecondToKnots,
  metersToFeet,
  pressureUnit,
  pressureValue,
  type UnitsMode,
} from '$shared/lib';
import type { Theme } from '$shared/ui';
import TrendChart from './TrendChart.svelte';
import { TREND_METRICS, type TrendKey, type TrendSeries } from './trend-metrics';

interface Props {
  // The 24 h history series when a provider answered, otherwise undefined per the panel's note.
  history: ReadonlyMap<TrendKey, TrendSeries> | undefined;
  sessionSeries: (key: TrendKey) => TrendSeries;
  mode: UnitsMode;
  theme: Theme;
}

const { history, sessionSeries, mode, theme }: Props = $props();

interface Display {
  convert: (si: number) => number | undefined;
  unit: string;
  digits: number;
}

const displays = $derived<Record<TrendKey, Display>>({
  depth: {
    convert: (si) => (mode === 'imperial' ? metersToFeet(si) : si),
    unit: lengthUnit(mode),
    digits: 1,
  },
  wind: { convert: metersPerSecondToKnots, unit: 'kn', digits: 1 },
  pressure: {
    convert: (si) => pressureValue(si, mode),
    unit: pressureUnit(mode),
    digits: mode === 'imperial' ? 2 : 0,
  },
  sog: { convert: metersPerSecondToKnots, unit: 'kn', digits: 1 },
});

interface Section {
  key: TrendKey;
  label: string;
  unit: string;
  digits: number;
  times: readonly number[];
  values: ReadonlyArray<number | null>;
  latest: string;
}

function converted(series: TrendSeries, display: Display): ReadonlyArray<number | null> {
  return series.values.map((value) => (value == null ? null : (display.convert(value) ?? null)));
}

const sections = $derived(
  TREND_METRICS.map((metric): Section => {
    const display = displays[metric.key];
    const series = history?.get(metric.key) ?? sessionSeries(metric.key);
    const values = converted(series, display);
    return {
      key: metric.key,
      label: metric.label,
      unit: display.unit,
      digits: display.digits,
      times: series.times,
      values,
      latest: formatFixed(values.findLast((value) => value != null) ?? null, display.digits),
    };
  }),
);

const hasData = (section: Section): boolean => section.values.some((value) => value != null);

// The point under the cursor per metric (value already in display units, time in epoch seconds), so
// the header reads back any past sample on hover and falls back to the latest when the cursor leaves.
let hovered = $state<Partial<Record<TrendKey, { timeSec: number; value: number | null }>>>({});
</script>

<div class="trend-charts">
  {#each sections as section (section.key)}
    {@const point = hovered[section.key]}
    <section class="panel-section" aria-label="{section.label} trend">
      <div class="head">
        <h3 class="caps-label">{section.label}</h3>
        {#if point}
          <span class="latest">
            <b class="num">{formatFixed(point.value, section.digits)}</b>
            {section.unit}
            <span class="at">at {formatClockTime(point.timeSec * 1000)}</span>
          </span>
        {:else}
          <span class="latest"><b class="num">{section.latest}</b> {section.unit}</span>
        {/if}
      </div>
      {#if hasData(section)}
        <TrendChart
          times={section.times}
          values={section.values}
          {theme}
          onHover={(p) => (hovered[section.key] = p)}
        />
      {:else}
        <p class="muted-note">No samples for this instrument yet.</p>
      {/if}
    </section>
  {/each}
</div>

<style>
.trend-charts {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
/* The metric title is an h3 for heading navigation; drop the UA heading margin so it sits on the
   baseline row with the live value rather than pushing the row taller. */
.head h3 {
  margin: 0;
}
.latest {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.latest b {
  color: var(--text);
  font-size: var(--text-base);
}
/* The hover timestamp trails the value at the fine-print scale so the value stays the loud element. */
.at {
  font-size: var(--text-xs);
}
</style>
