<script lang="ts">
import { onDestroy } from 'svelte';
import { Clock, formatClockTime, formatFixed, MINUTE_MS, type UnitsSelection } from '$shared/lib';
import type { Theme } from '$shared/ui';
import TrendChart from './TrendChart.svelte';
import {
  type AttributedTrendSeries,
  hasTrendSamples,
  type TrendAnnotation,
  type TrendCoverage,
  type TrendDangerSide,
  trendAnnotation,
  trendCoverage,
  trendDangerSide,
  trendDisplayFor,
  trendNoiseFloor,
} from './trend-metrics';
import type { TrendItem, TrendsController } from './trends-controller.svelte';

interface Props {
  controller: TrendsController;
  units: UnitsSelection;
  theme: Theme;
}

const { controller, units, theme }: Props = $props();

// A coarse minute tick so the last-sample age and staleness marks keep tracking the wall clock
// during a long open, the WeatherMap idiom.
const clock = new Clock(MINUTE_MS);
onDestroy(() => clock.dispose());

interface Section {
  item: TrendItem;
  source: 'history' | 'session' | 'none';
  sourceSeries: AttributedTrendSeries;
  unit: string;
  digits: number;
  times: readonly number[];
  values: ReadonlyArray<number | null>;
  annotation: TrendAnnotation | undefined;
  dangerSide: TrendDangerSide;
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
        annotation: undefined,
        dangerSide: 'both',
      };
    }
    const history = controller.history?.series.get(item.id);
    const session = controller.sessionSeries(item.id);
    const historyAvailable = hasTrendSamples(history);
    const sourceSeries: AttributedTrendSeries = historyAvailable && history ? history : session;
    // Ordered guards rather than a nested ternary, matching the panel's stated house practice.
    let source: 'history' | 'session' | 'none' = 'none';
    if (historyAvailable) source = 'history';
    else if (hasTrendSamples(session)) source = 'session';
    const display = trendDisplayFor(descriptor, units);
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
      annotation: trendAnnotation(sourceSeries, trendNoiseFloor(descriptor.display)),
      dangerSide: trendDangerSide(descriptor.display),
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

// The deterministic annotation line under each chart: the verdict from the first-to-last change
// against the kind's noise floor, the extreme on the kind's danger side (both when neither
// dominates), and the net change. All values are converted at this display edge; the net change is
// a difference of two converted values so an offset conversion cannot distort it.
function annotationText(section: Section): string | undefined {
  const annotation = section.annotation;
  if (!annotation) return undefined;
  const verdict = annotation.verdict.charAt(0).toUpperCase() + annotation.verdict.slice(1);
  const parts = [verdict];
  const low = section.values[annotation.minIndex];
  const high = section.values[annotation.maxIndex];
  if (section.dangerSide !== 'max' && low != null) {
    parts.push(`low ${formatFixed(low, section.digits)}${unitSuffix(section)}`);
  }
  if (section.dangerSide !== 'min' && high != null) {
    parts.push(`high ${formatFixed(high, section.digits)}${unitSuffix(section)}`);
  }
  const first = section.values[annotation.firstIndex];
  const last = section.values[annotation.lastIndex];
  if (first != null && last != null) {
    const net = last - first;
    let netText = formatFixed(net, section.digits);
    // A change that rounds to zero drops its sign, so a hair under steady never reads "-0.0".
    if (Number.parseFloat(netText) === 0) netText = formatFixed(Math.abs(net), section.digits);
    else if (net > 0) netText = `+${netText}`;
    parts.push(`net ${netText}${unitSuffix(section)}`);
  }
  return parts.join(' · ');
}

// The honesty line under each chart: coverage, longest hole, and the newest sample's age, with
// Partial and Stale words rather than color alone. Visible and read by screen readers through the
// same paragraph.
function durationText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest.toString().padStart(2, '0')}m` : `${hours}h`;
}

function coverageText(coverage: TrendCoverage): string {
  const marks = [coverage.partial ? 'Partial' : '', coverage.stale ? 'Stale' : '']
    .filter(Boolean)
    .join(', ');
  const facts = [
    `${Math.round(coverage.coverageFraction * 100)}% of samples present`,
    coverage.longestGapSec > 0 ? `longest gap ${durationText(coverage.longestGapSec)}` : '',
    `last sample ${durationText(coverage.lastSampleAgeSec)} ago`,
  ]
    .filter(Boolean)
    .join(', ');
  return marks ? `${marks}: ${facts}.` : `${facts}.`;
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

// A trend id can be a discovered instrument id carrying dots and colons, so it is encoded before it
// becomes an id attribute the output's `for` has to match.
function scrubberInputId(id: string): string {
  return `trend-scrubber-${encodeURIComponent(id)}`;
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
    {@const coverage = trendCoverage(section.sourceSeries, clock.now / 1000)}
    {@const annotationLine = annotationText(section)}
    {@const scrubberId = scrubberInputId(section.item.id)}
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
            id={scrubberId}
            class="range"
            type="range"
            min="0"
            max={Math.max(0, section.times.length - 1)}
            step="1"
            value={index}
            aria-label={`Browse ${section.item.label} history`}
            aria-valuetext={valueText(section, index)}
            oninput={(event) => {
              inspected[section.item.id] = event.currentTarget.valueAsNumber;
            }}
          >
          <output for={scrubberId}>{valueText(section, index)}</output>
        </div>
        {#if annotationLine}
          <p class="annotation">{annotationLine}</p>
        {/if}
        <p class="summary">{summary(section)}</p>
        {#if coverage}
          <p class="summary" class:coverage-flagged={coverage.partial || coverage.stale}>
            {coverageText(coverage)}
          </p>
        {/if}
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
.summary,
.annotation {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
/* The annotation's numbers stay column-steady while samples update. */
.annotation {
  font-variant-numeric: tabular-nums;
}
/* A flagged coverage line lifts to the warning tone; the Partial and Stale words carry the meaning
   without the color. */
.coverage-flagged {
  color: var(--warning);
}
.timeline {
  display: grid;
  min-inline-size: 0;
  gap: var(--space-1);
}
.timeline input {
  min-block-size: var(--control-size);
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
