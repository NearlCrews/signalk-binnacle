<script lang="ts">
import { formatClockTime, formatFixed, type UnitsMode } from '$shared/lib';
import type { Theme } from '$shared/ui';
import TrendChart from './TrendChart.svelte';
import { type AttributedTrendSeries, hasTrendSamples, trendDisplayFor } from './trend-metrics';
import type { TrendItem, TrendsController } from './trends-controller.svelte';

interface Props {
  controller: TrendsController;
  mode: UnitsMode;
  theme: Theme;
}

const { controller, mode, theme }: Props = $props();

interface Section {
  item: TrendItem;
  source: 'history' | 'session' | 'none';
  sourceSeries: AttributedTrendSeries;
  unit: string;
  digits: number;
  times: readonly number[];
  values: ReadonlyArray<number | null>;
}

const sections = $derived(
  controller.charts.map((item): Section => {
    const descriptor = item.descriptor;
    if (!descriptor) {
      return {
        item,
        source: 'none',
        sourceSeries: { times: [], values: [] },
        unit: '',
        digits: 0,
        times: [],
        values: [],
      };
    }
    const history = controller.history?.series.get(item.id);
    const session = controller.sessionSeries(item.id);
    const historyAvailable = hasTrendSamples(history);
    const sourceSeries: AttributedTrendSeries = historyAvailable && history ? history : session;
    const source = historyAvailable ? 'history' : hasTrendSamples(session) ? 'session' : 'none';
    const display = trendDisplayFor(descriptor, mode);
    return {
      item,
      source,
      sourceSeries,
      unit: display.unit,
      digits: display.digits,
      times: sourceSeries.times,
      values: sourceSeries.values.map((value) =>
        value == null ? null : (display.convert(value) ?? null),
      ),
    };
  }),
);

let inspected = $state<Record<string, number>>({});

function inspectIndex(section: Section): number {
  const requested = inspected[section.item.id];
  if (requested !== undefined && requested >= 0 && requested < section.values.length) {
    return requested;
  }
  return Math.max(
    0,
    section.values.findLastIndex((value) => value != null),
  );
}

function valueAt(section: Section, index: number): string {
  return formatFixed(section.values[index] ?? null, section.digits);
}

function unitSuffix(section: Section): string {
  return section.unit ? ` ${section.unit}` : '';
}

function summary(section: Section): string {
  let first = -1;
  let last = -1;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < section.values.length; index += 1) {
    const value = section.values[index];
    if (value == null) continue;
    if (first < 0) first = index;
    last = index;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (first < 0 || last < 0) return 'No samples.';
  return [
    `Latest ${valueAt(section, last)}${unitSuffix(section)}`,
    `minimum ${formatFixed(minimum, section.digits)}${unitSuffix(section)}`,
    `maximum ${formatFixed(maximum, section.digits)}${unitSuffix(section)}`,
    `start ${valueAt(section, first)}${unitSuffix(section)}`,
    `end ${valueAt(section, last)}${unitSuffix(section)}`,
  ].join(', ');
}

function sourceLabel(section: Section): string {
  const series = section.sourceSeries;
  const path = series.path ? ` · ${series.path}` : '';
  const reference = series.referenceLabel ? ` · ${series.referenceLabel}` : '';
  if (section.source === 'history') {
    return `Last 24 hours${series.provider ? ` · ${series.provider}` : ''}${path}${reference}`;
  }
  if (section.source === 'session') {
    return controller.focusedTransient
      ? `Focused session started when this trend opened${path}${reference}`
      : `This session${path}${reference}`;
  }
  if (controller.focusedTransient) {
    return 'Focused session started when this trend opened. No samples yet.';
  }
  if (section.item.unavailable) return 'Saved selection unavailable on this server.';
  if (controller.historyState === 'empty') return 'No history or session samples.';
  return 'No samples for this instrument yet.';
}

function valueText(section: Section, index: number): string {
  const time = section.times[index];
  const timeLabel = Number.isFinite(time) ? formatClockTime(time * 1000) : 'Unknown time';
  return `${timeLabel}, ${valueAt(section, index)}${unitSuffix(section)}`;
}
</script>

<div class="trend-charts">
  {#each sections as section (section.item.id)}
    {@const index = inspectIndex(section)}
    {@const hasData = section.values.some((value) => value != null)}
    <section class="panel-section trend-section" aria-label="{section.item.label} trend">
      <div class="head">
        <h3 class="caps-label">{section.item.label}</h3>
        {#if hasData}
          <span class="latest">
            <b class="num">{valueAt(section, index)}</b>{unitSuffix(section)}
            <span class="at">at {formatClockTime(section.times[index] * 1000)}</span>
          </span>
        {/if}
      </div>
      <p class="source-note">{sourceLabel(section)}</p>
      {#if hasData}
        <TrendChart
          times={section.times}
          values={section.values}
          {theme}
          onHoverIndex={(hoveredIndex) => {
            if (hoveredIndex !== undefined) inspected[section.item.id] = hoveredIndex;
          }}
        />
        <div class="timeline">
          <input
            class="range"
            type="range"
            min="0"
            max={Math.max(0, section.times.length - 1)}
            step="1"
            value={index}
            aria-label={`Inspect ${section.item.label} timeline`}
            aria-valuetext={valueText(section, index)}
            oninput={(event) => {
              inspected[section.item.id] = event.currentTarget.valueAsNumber;
            }}
          >
          <output>{valueText(section, index)}</output>
        </div>
        <p class="summary">{summary(section)}</p>
      {:else}
        <p class="muted-note">No samples for this instrument yet.</p>
      {/if}
    </section>
  {/each}
</div>

<style>
.trend-charts {
  display: flex;
  min-inline-size: 0;
  flex-direction: column;
  gap: var(--space-4);
}
.trend-section {
  min-inline-size: 0;
}
.head {
  display: flex;
  min-inline-size: 0;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-2);
}
.head h3 {
  min-inline-size: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.latest {
  min-inline-size: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}
.latest b {
  color: var(--text);
  font-size: var(--text-base);
}
.at {
  margin-inline-start: var(--space-1);
  font-size: var(--text-xs);
}
.source-note,
.summary {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
.timeline {
  display: grid;
  min-inline-size: 0;
  gap: var(--space-1);
}
.timeline input {
  min-block-size: 44px;
  inline-size: 100%;
  margin: 0;
  touch-action: pan-y;
}
.timeline output {
  min-inline-size: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}
</style>
