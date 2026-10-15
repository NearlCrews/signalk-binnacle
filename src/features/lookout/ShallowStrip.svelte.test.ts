import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { UnitsStore } from '$entities/units';
import type { UnitsMode } from '$shared/lib';
import { PersistedValue } from '$shared/settings';
import { createFakeStorage } from '$shared/testing';
import ShallowStrip from './ShallowStrip.svelte';
import type { ShallowAlarmView } from './shallow-monitor.svelte';

const units = new UnitsStore(
  new PersistedValue<UnitsMode>('binnacle:units-test', 'metric', createFakeStorage()),
);

function view(overrides: Partial<ShallowAlarmView> = {}): ShallowAlarmView {
  return {
    alarming: true,
    acknowledged: false,
    rearmBelowMeters: undefined,
    depthMeters: 2.5,
    depthSource: 'keel',
    effectiveLimitMeters: 3,
    insideServerZone: false,
    acknowledge: () => {},
    ...overrides,
  };
}

const body = (shallow: ShallowAlarmView) =>
  render(ShallowStrip, { props: { shallow, units } }).body;

describe('ShallowStrip', () => {
  it('names the alarm, shows depth and limit with the datum, and offers Acknowledge', () => {
    const html = body(view());
    expect(html).toContain('aria-label="Shallow water"');
    expect(html).toContain('bottom-strip--alarm');
    expect(html).toMatch(/Depth[\s\S]*?2\.5/);
    expect(html).toMatch(/Limit[\s\S]*?3(\.0)?/);
    expect(html).toContain('Depth below the keel');
    expect(html).toMatch(/Acknowledge\s*<\/button>/);
  });

  it('names the server zone instead of a limit the depth already clears', () => {
    const html = body(view({ depthMeters: 4, insideServerZone: true }));
    expect(html).toContain("Inside the server's depth alarm zone");
    expect(html).not.toContain('Limit');
  });

  it('leaves out a re-arm depth at or below zero', () => {
    const html = body(view({ acknowledged: true, rearmBelowMeters: 0 }));
    expect(html).not.toContain('Sounds again below');
  });

  it('steps down once acknowledged and says when it sounds again', () => {
    const html = body(view({ acknowledged: true, rearmBelowMeters: 2.2 }));
    expect(html).toContain('is-ack');
    expect(html).toContain('Sounds again below 2.2 m.');
    expect(html).not.toMatch(/Acknowledge\s*<\/button>/);
  });

  it('renders nothing while the watch is not alarming', () => {
    expect(body(view({ alarming: false }))).not.toContain('bottom-strip');
  });
});
