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

  it('lays each leg out as two lines so the table survives narrow phones', () => {
    const body = renderPlan();
    const rows = body.match(/leg-line--metrics/g) ?? [];
    expect(rows.length).toBe(routeLegs(waypoints).length);
  });
});
