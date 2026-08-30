import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeLegs } from '$entities/route';
import { formatClockTime, PLACEHOLDER } from '$shared/lib';
import { etaSeconds } from '$shared/nav';
import { PersistedValue } from '$shared/settings';
import RouteEditPlan from './RouteEditPlan.svelte';

// Roughly 60 nm of southing, so the plan has one long leg and one short one.
const waypoints = [
  { position: { latitude: 42, longitude: -83 } },
  { position: { latitude: 43, longitude: -83 }, name: 'Harbor Ledge' },
  { position: { latitude: 43.05, longitude: -83 } },
];

function speed(mps: number): PersistedValue<number> {
  return new PersistedValue('route-plan-test-speed', mps, {
    getItem: () => null,
    setItem: () => {},
  });
}

function renderPlan(overrides: Record<string, unknown> = {}): string {
  return render(RouteEditPlan, {
    props: {
      working: { id: 'r1', name: 'Passage', waypoints },
      highlight: undefined,
      onHighlightLeg: vi.fn(),
      planningSpeed: speed(5),
      ...overrides,
    },
  }).body;
}

describe('RouteEditPlan', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 10, 23, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names each leg endpoint, falling back to its point number', () => {
    const body = renderPlan();
    expect(body).toContain('Harbor Ledge');
    expect(body).toContain('Point 3');
    expect(body).toContain('Passage duration');
    expect(body).toContain('Elapsed');
  });

  it('defaults the departure to now without persisting it', () => {
    expect(renderPlan()).toContain('value="2026-08-10T23:00"');
  });

  it('shows planned arrival clock times that recompute with the planning speed', () => {
    const legs = routeLegs(waypoints);
    const firstLegMeters = legs[0].distanceMeters;
    const departure = new Date(2026, 7, 10, 23, 0).getTime();
    for (const mps of [5, 10]) {
      const arrival = departure + (etaSeconds(firstLegMeters, mps) ?? 0) * 1000;
      expect(renderPlan({ planningSpeed: speed(mps) })).toContain(formatClockTime(arrival));
    }
  });

  it('names the date when an arrival crosses local midnight', () => {
    // 60 nm at 5 m/s is over six hours from a 23:00 departure, landing the next day.
    const legs = routeLegs(waypoints);
    const departure = new Date(2026, 7, 10, 23, 0).getTime();
    const arrival = departure + (etaSeconds(legs[0].distanceMeters, 5) ?? 0) * 1000;
    const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
      new Date(arrival),
    );
    expect(renderPlan()).toContain(`${formatClockTime(arrival)} ${day}`);
  });

  it('recomputes arrivals when the geometry changes', () => {
    const departure = new Date(2026, 7, 10, 23, 0).getTime();
    const shorter = waypoints.slice(0, 2);
    const arrival = (points: typeof waypoints) => {
      const total = routeLegs(points).reduce((sum, leg) => sum + leg.distanceMeters, 0);
      return formatClockTime(departure + (etaSeconds(total, 5) ?? 0) * 1000);
    };
    expect(renderPlan({ working: { id: 'r1', name: 'Passage', waypoints: shorter } })).toContain(
      arrival(shorter),
    );
    expect(arrival(shorter)).not.toBe(arrival(waypoints));
  });

  it('keeps every time unavailable at zero planning speed', () => {
    const body = renderPlan({ planningSpeed: speed(0) });
    expect(body).toContain(`Elapsed ${PLACEHOLDER}`);
    const arrivals = body.match(/class="leg-arrive num[^"]*"[^>]*>([^<]*)</g) ?? [];
    expect(arrivals.length).toBeGreaterThan(0);
    for (const cell of arrivals) expect(cell).toContain(PLACEHOLDER);
  });

  it('gives each leg its own metrics line so the table survives narrow phones', () => {
    const body = renderPlan();
    const rows = body.match(/leg-elapsed/g) ?? [];
    expect(rows.length).toBe(routeLegs(waypoints).length);
  });
});

const HOUR = 3_600_000;

// An obviously synthetic uniform grid over the test waypoints: wind five meters per second from
// true north, gusting ten, hourly steps from the given start.
function testGrid(startIso: string): Record<string, unknown> {
  const times = Array.from({ length: 12 }, (_, i) => Date.parse(startIso) + i * HOUR);
  const fill = (value: number) => times.map(() => new Array(4).fill(value));
  return {
    lats: [41, 44],
    lons: [-84, -82],
    times,
    windU: fill(0),
    windV: fill(-5),
    windGust: fill(10),
  };
}

describe('RouteEditPlan planning cues', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // From a 02:00Z departure at 5 m/s, both arrivals land near 08:10Z and 08:29Z, hours before the
  // 10:34Z sunrise at 43 N 83 W on 2026-08-11.
  it('flags each arrival that lands after dark', () => {
    vi.setSystemTime(new Date('2026-08-11T02:00:00Z'));
    const body = renderPlan();
    expect(body.match(/After dark/g)).toHaveLength(2);
  });

  it('leaves daylight arrivals unflagged', () => {
    vi.setSystemTime(new Date('2026-08-11T15:00:00Z'));
    expect(renderPlan()).not.toContain('After dark');
  });

  it('shows the forecast wind at each planned arrival, with the advisory note', () => {
    vi.setSystemTime(new Date('2026-08-11T02:00:00Z'));
    const body = renderPlan({ weatherGrid: testGrid('2026-08-11T00:00:00Z') });
    expect(body.match(/Wind 9\.7 kn gust 19\.4 from 000/g)).toHaveLength(2);
    expect(body).toContain('advisory only');
  });

  it('shows no wind line when the grid does not cover the arrival times', () => {
    vi.setSystemTime(new Date('2026-08-11T02:00:00Z'));
    const body = renderPlan({ weatherGrid: testGrid('2026-08-09T00:00:00Z') });
    expect(body).not.toContain('Wind ');
    expect(body).not.toContain('advisory only');
  });

  it('shows no wind line and no note without a grid', () => {
    vi.setSystemTime(new Date('2026-08-11T02:00:00Z'));
    const body = renderPlan();
    expect(body).not.toContain('Wind ');
    expect(body).not.toContain('advisory only');
  });

  it('honors the units preference profile in the wind line', () => {
    vi.setSystemTime(new Date('2026-08-11T02:00:00Z'));
    const body = renderPlan({
      weatherGrid: testGrid('2026-08-11T00:00:00Z'),
      units: {
        length: 'm',
        speed: 'm/s',
        temperature: 'C',
        pressure: 'hPa',
        precip: 'mm/h',
        landDistance: 'km',
      },
    });
    expect(body).toContain('Wind 5.0 m/s gust 10.0 from 000');
  });
});
