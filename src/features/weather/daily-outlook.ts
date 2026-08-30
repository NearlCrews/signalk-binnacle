import type { WeatherGrid } from '$entities/weather';
import { forecastRiskCues } from './forecast-series';
import type { PointConditions } from './signalk-weather';
import { conditionsFromReadout, readoutAt } from './weather-readout';

// The day-grouped outlook past the hourly forecast rows: the free grid spans up to seven days,
// while the hourly list covers about 36 hours, and the days between deserve a compact summary
// rather than silence. Grouping is by the device's LOCAL calendar day, matching every other local
// wall-clock label in the panel.

const MAX_OUTLOOK_DAYS = 7;
const TWO_PI = 2 * Math.PI;
const DIRECTION_SECTORS = 16;
const SECTOR_RAD = TWO_PI / DIRECTION_SECTORS;

// Severity order for the one cue a day row shows, mirroring the cue strings forecastRiskCues
// emits; a cue this list does not know still shows, ranked below the known ones.
const CUE_RANK = [
  'Storm-force wind',
  'Gale-force wind',
  'Rapid pressure fall',
  'Rough seas',
  'Dense fog',
  'Strong current',
];

export interface DayOutlook {
  dayStartMs: number;
  windMinMs?: number;
  windMaxMs?: number;
  // Circular mean of the day's most-populated 22.5-degree direction sector: where the wind spends
  // most of the day, not a mean across a veer that would point somewhere it never blew from.
  dominantFromRad?: number;
  gustMaxMs?: number;
  precipTotalMm?: number;
  worstRiskCue?: string;
}

export function startOfLocalDay(timeMs: number): number {
  const day = new Date(timeMs);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// Weekday-only label for a day row ("Fri"); formatMonthDay supplies the date half. Constructed
// once, like the shared Intl formatters, since it takes no per-call options.
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

export function outlookDayName(timeMs: number): string {
  return Number.isFinite(timeMs) ? WEEKDAY_FORMAT.format(new Date(timeMs)) : '';
}

// Per-step conditions at the vessel for every grid step from fromMs on, risk cues included.
// Sampling starts at fromMs rather than the first outlook day so the pressure-fall cue has its
// preceding sample at each day boundary.
export function gridOutlookSamples(
  grid: WeatherGrid,
  position: [number, number],
  fromMs: number,
): PointConditions[] {
  const [lat, lon] = position;
  const samples: PointConditions[] = [];
  for (let i = 0; i < grid.times.length; i++) {
    const timeMs = grid.times[i];
    if (timeMs < fromMs) continue;
    const readout = readoutAt(grid, lon, lat, i);
    if (readout) samples.push(conditionsFromReadout(readout, timeMs));
  }
  return forecastRiskCues(samples);
}

// Summarizes the sampled conditions into one row per local calendar day strictly AFTER the day
// containing afterMs, so the days the hourly list already covers are never restated.
export function dailyOutlook(samples: PointConditions[], afterMs: number): DayOutlook[] {
  const afterDayMs = startOfLocalDay(afterMs);
  const days = new Map<number, PointConditions[]>();
  for (const row of samples) {
    if (!Number.isFinite(row.timeMs)) continue;
    const dayStartMs = startOfLocalDay(row.timeMs);
    if (dayStartMs <= afterDayMs) continue;
    const rows = days.get(dayStartMs);
    if (rows) rows.push(row);
    else days.set(dayStartMs, [row]);
  }
  return [...days.entries()]
    .sort(([left], [right]) => left - right)
    .slice(0, MAX_OUTLOOK_DAYS)
    .map(([dayStartMs, rows]) => summarizeDay(dayStartMs, rows));
}

function summarizeDay(dayStartMs: number, rows: PointConditions[]): DayOutlook {
  let windMinMs: number | undefined;
  let windMaxMs: number | undefined;
  let gustMaxMs: number | undefined;
  let precipTotalMm: number | undefined;
  for (const row of rows) {
    if (row.windMs !== undefined) {
      windMinMs = windMinMs === undefined ? row.windMs : Math.min(windMinMs, row.windMs);
      windMaxMs = windMaxMs === undefined ? row.windMs : Math.max(windMaxMs, row.windMs);
    }
    if (row.gustMs !== undefined) {
      gustMaxMs = gustMaxMs === undefined ? row.gustMs : Math.max(gustMaxMs, row.gustMs);
    }
    // Both row sources carry per-step accumulations (the grid's preceding-hour millimeters on
    // hourly steps, a provider's per-step volume), so plain summation is the day total.
    if (row.precipitationMm !== undefined) {
      precipTotalMm = (precipTotalMm ?? 0) + row.precipitationMm;
    }
  }
  return {
    dayStartMs,
    windMinMs,
    windMaxMs,
    dominantFromRad: dominantFromRad(rows),
    gustMaxMs,
    precipTotalMm,
    worstRiskCue: worstCue(rows),
  };
}

function sectorOf(fromRad: number): number {
  const normalized = ((fromRad % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round(normalized / SECTOR_RAD) % DIRECTION_SECTORS;
}

function dominantFromRad(rows: PointConditions[]): number | undefined {
  const counts = new Array<number>(DIRECTION_SECTORS).fill(0);
  let sampled = 0;
  for (const row of rows) {
    if (row.fromRad === undefined) continue;
    sampled += 1;
    counts[sectorOf(row.fromRad)] += 1;
  }
  if (sampled === 0) return undefined;
  let winner = 0;
  for (let sector = 1; sector < DIRECTION_SECTORS; sector++) {
    if (counts[sector] > counts[winner]) winner = sector;
  }
  // Directions within one sector span 22.5 degrees, so their unit vectors cannot cancel.
  let x = 0;
  let y = 0;
  for (const row of rows) {
    if (row.fromRad === undefined || sectorOf(row.fromRad) !== winner) continue;
    x += Math.cos(row.fromRad);
    y += Math.sin(row.fromRad);
  }
  return (Math.atan2(y, x) + TWO_PI) % TWO_PI;
}

function worstCue(rows: PointConditions[]): string | undefined {
  let best: string | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    for (const cue of row.riskCues ?? []) {
      const known = CUE_RANK.indexOf(cue);
      const rank = known === -1 ? CUE_RANK.length : known;
      if (rank < bestRank) {
        bestRank = rank;
        best = cue;
      }
    }
  }
  return best;
}
