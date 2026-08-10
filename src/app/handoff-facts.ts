import type { HandoffFact } from '$entities/handoff';
import { formatDuration, formatNmOr } from '$shared/lib';

// Builds the fact lines a watch-handoff snapshot captures, from getters the composition root wires
// to the live stores. Values are rendered to plain text at snapshot time on purpose: a handoff
// records what was known when it was taken, and stale inputs must read as stale rather than being
// silently re-derived later. Reading these getters mutates nothing.

export interface HandoffFactDeps {
  now: () => number;
  fix: () => { received: boolean; stale: boolean; epochMs: number };
  course: () => {
    destination: string | undefined;
    xteMeters: number | undefined;
    ttgSeconds: number | undefined;
    ttgBasis: 'server' | 'vmg' | undefined;
  };
  alarms: () => { raised: number; worst: string | undefined; collisionMutedUntilMs?: number };
  collision: () => {
    worst: string;
    unassessed: number;
    topCpaMeters: number | undefined;
    topTcpaSeconds: number | undefined;
  };
  depthWatch: () => 'monitoring' | 'stale' | 'no-reading' | 'no-source';
  radar: () => string;
  weatherFetchedAtMs: () => number | undefined;
  tides: () => string;
  routeCoverage: () => string | undefined;
}

function ageText(now: number, epochMs: number): string {
  const seconds = Math.max(0, Math.round((now - epochMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, '0')}m ago`;
}

const DEPTH_WATCH_TEXT = {
  monitoring: 'monitoring',
  stale: 'paused, depth reading is stale',
  'no-reading': 'paused, no depth reading',
  'no-source': 'no depth source on this server',
} as const;

export function collectHandoffFacts(deps: HandoffFactDeps): HandoffFact[] {
  const now = deps.now();
  const facts: HandoffFact[] = [];

  const fix = deps.fix();
  facts.push({
    label: 'GPS fix',
    value: !fix.received
      ? 'none this session'
      : fix.stale
        ? `stale, last fix ${ageText(now, fix.epochMs)}`
        : `live, ${ageText(now, fix.epochMs)}`,
  });

  const course = deps.course();
  if (course.destination === undefined) {
    facts.push({ label: 'Course', value: 'not navigating' });
  } else {
    const xte = course.xteMeters === undefined ? '' : `, XTE ${formatNmOr(course.xteMeters)} nm`;
    const ttg =
      course.ttgSeconds === undefined || course.ttgBasis === undefined
        ? ''
        : `, time to go ${formatDuration(course.ttgSeconds)} (${
            course.ttgBasis === 'server' ? 'server estimate' : 'VMG estimate'
          })`;
    facts.push({ label: 'Course', value: `to ${course.destination}${xte}${ttg}` });
  }

  const alarms = deps.alarms();
  const muted =
    alarms.collisionMutedUntilMs !== undefined && alarms.collisionMutedUntilMs > now
      ? `, collision alarm muted another ${formatDuration(
          (alarms.collisionMutedUntilMs - now) / 1000,
        )}`
      : '';
  facts.push({
    label: 'Alarms',
    value:
      alarms.raised === 0
        ? `none raised${muted}`
        : `${alarms.raised} raised, worst ${alarms.worst ?? 'unknown'}${muted}`,
  });

  const collision = deps.collision();
  const top =
    collision.topCpaMeters !== undefined && collision.topTcpaSeconds !== undefined
      ? `, closest ${formatNmOr(collision.topCpaMeters)} nm in ${formatDuration(collision.topTcpaSeconds)}`
      : '';
  const unassessed =
    collision.unassessed > 0
      ? `, ${collision.unassessed} contact${collision.unassessed === 1 ? '' : 's'} not assessable`
      : '';
  facts.push({ label: 'Collision watch', value: `${collision.worst}${top}${unassessed}` });

  facts.push({ label: 'Depth watch', value: DEPTH_WATCH_TEXT[deps.depthWatch()] });
  facts.push({ label: 'Radar', value: deps.radar() });

  const weatherAt = deps.weatherFetchedAtMs();
  facts.push({
    label: 'Weather forecast',
    value: weatherAt === undefined ? 'not loaded' : `fetched ${ageText(now, weatherAt)}`,
  });
  facts.push({ label: 'Tides', value: deps.tides() });
  facts.push({
    label: 'Route offline coverage',
    value: deps.routeCoverage() ?? 'not checked this session',
  });

  return facts;
}
