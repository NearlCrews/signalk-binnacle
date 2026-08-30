import { describe, expect, it } from 'vitest';
import { collectHandoffFacts, type HandoffFactDeps } from './handoff-facts';

const NOW = 1_000_000_000;

function deps(overrides: Partial<HandoffFactDeps> = {}): HandoffFactDeps {
  return {
    now: () => NOW,
    fix: () => ({ received: true, stale: false, epochMs: NOW - 2_000 }),
    course: () => ({
      destination: undefined,
      xteMeters: undefined,
      ttgSeconds: undefined,
      ttgBasis: undefined,
    }),
    alarms: () => ({ raised: 0, worst: undefined }),
    collision: () => ({
      worst: 'clear',
      unassessed: 0,
      topCpaMeters: undefined,
      topTcpaSeconds: undefined,
    }),
    depthWatch: () => 'monitoring',
    radar: () => 'not streaming',
    alarmChronology: () => undefined,
    weatherFetchedAtMs: () => undefined,
    tides: () => 'not loaded',
    routeCoverage: () => undefined,
    multiSourcePaths: () => [],
    ...overrides,
  };
}

function fact(facts: ReturnType<typeof collectHandoffFacts>, label: string): string {
  const found = facts.find((entry) => entry.label === label);
  if (!found) throw new Error(`missing fact ${label}`);
  return found.value;
}

describe('collectHandoffFacts', () => {
  it('captures a quiet baseline honestly, including what was never loaded', () => {
    const facts = collectHandoffFacts(deps());
    expect(fact(facts, 'GPS fix')).toBe('live, 2s ago');
    expect(fact(facts, 'Course')).toBe('not navigating');
    expect(fact(facts, 'Alarms')).toBe('none raised');
    expect(fact(facts, 'Collision watch')).toBe('clear');
    expect(fact(facts, 'Depth watch')).toBe('monitoring');
    expect(fact(facts, 'Weather forecast')).toBe('not loaded');
    expect(fact(facts, 'Route offline coverage')).toBe('not checked this session');
  });

  it('names a path only when more than one recent source feeds it', () => {
    const quiet = collectHandoffFacts(deps());
    expect(quiet.some((entry) => entry.label === 'Sensor sources')).toBe(false);
    const facts = collectHandoffFacts(
      deps({
        multiSourcePaths: () => [
          { name: 'position', refs: ['gps0.GP', 'gps1.GP'] },
          { name: 'depth', refs: ['sounder.1', 'scanner.2'] },
        ],
      }),
    );
    expect(fact(facts, 'Sensor sources')).toBe(
      'position: gps0.GP, gps1.GP; depth: sounder.1, scanner.2',
    );
  });

  it('renders stale and missing inputs as such rather than re-deriving them', () => {
    const facts = collectHandoffFacts(
      deps({
        fix: () => ({ received: true, stale: true, epochMs: NOW - 120_000 }),
        depthWatch: () => 'no-source',
      }),
    );
    expect(fact(facts, 'GPS fix')).toBe('stale, last fix 2m ago');
    expect(fact(facts, 'Depth watch')).toBe('no depth source on this server');
  });

  it('qualifies the course estimate with its basis and reports the mute expiry', () => {
    const facts = collectHandoffFacts(
      deps({
        course: () => ({
          destination: 'Harbor Ledge',
          xteMeters: 185.2,
          ttgSeconds: 3_600,
          ttgBasis: 'vmg',
        }),
        alarms: () => ({ raised: 2, worst: 'alarm', collisionMutedUntilMs: NOW + 300_000 }),
        collision: () => ({
          worst: 'warning',
          unassessed: 1,
          topCpaMeters: 926,
          topTcpaSeconds: 600,
        }),
      }),
    );
    expect(fact(facts, 'Course')).toBe(
      'to Harbor Ledge, XTE 0.10 nm, time to go 1h 00m (VMG estimate)',
    );
    expect(fact(facts, 'Alarms')).toBe(
      '2 raised, worst alarm, collision alarm muted another 5 min',
    );
    expect(fact(facts, 'Collision watch')).toBe(
      'warning, closest 0.50 nm in 10 min, 1 contact not assessable',
    );
  });
});
