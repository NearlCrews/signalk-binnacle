import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { AnchorWatch } from '$entities/anchor';
import { UnitsStore } from '$entities/units';
import { OwnVessel } from '$entities/vessel';
import type { ReactiveClock } from '$shared/lib';
import type { ConnectionPhase, SKFrame } from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage } from '$shared/testing';
import StatusStrip from './StatusStrip.svelte';

const clock: ReactiveClock = { now: Date.UTC(2026, 0, 1, 12, 0, 0) };

function baseProps() {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const anchor = new AnchorWatch(store, vessel, createFakeStorage());
  return {
    connectionLabel: 'Connected',
    streamError: false,
    online: true,
    fixStale: false,
    // The whole union, not the literal: a case that overrides this on a spread of baseProps() has
    // to stay assignable to the fixture's own type.
    connectionPhase: 'open' as ConnectionPhase,
    aisCount: 0,
    anchor,
    units: new UnitsStore(),
    vessel,
    shallowAlarming: false,
    pinnedActions: [],
    clock,
    onReconnect: () => {},
  };
}

// Rendered to an SSR HTML string (the suite runs in the node environment, no DOM), enough to pin
// the Depth readout's alarm styling on and off, matching ChartLockerStatus's own SSR-string
// verification pattern for a presentational strip component.
function body(props: ReturnType<typeof baseProps>): string {
  return render(StatusStrip, { props }).body;
}

describe('StatusStrip depth alarm', () => {
  it('shows the toolbar clock as local time, not UTC', () => {
    const html = body(baseProps());
    expect(html).toContain('title="Local time"');
    expect(html).not.toContain('UTC time');
    expect(html).not.toContain('UTC</b>');
  });

  it('does not mark the Depth readout when the shallow alarm is not sounding', () => {
    const html = body(baseProps());
    expect(html).not.toContain('depth-alarm');
    expect(html).toContain('No depth source is publishing');
  });

  it('labels the transducer datum when only the transducer publishes', () => {
    const props = baseProps();
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame({
      self: new Map([['environment.depth.belowTransducer', 4]]) as SKFrame['self'],
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    const html = body({ ...props, vessel });
    expect(html).toContain('Depth below the transducer');
    expect(html).toContain('Xducer');
    expect(html).not.toContain('No depth source is publishing');
  });

  it('prefers and labels the keel datum when the boat publishes it', () => {
    const props = baseProps();
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame({
      self: new Map([
        ['environment.depth.belowTransducer', 4],
        ['environment.depth.belowKeel', 3.2],
      ]) as SKFrame['self'],
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    const html = body({ ...props, vessel });
    expect(html).toContain('Depth below the keel');
    expect(html).toContain('Keel');
    expect(html).toContain('3.2');
    expect(html).not.toContain('>4.0<');
  });

  it('marks the Depth readout and swaps its tooltip when the shallow alarm is sounding', () => {
    const html = body({ ...baseProps(), shallowAlarming: true });
    expect(html).toContain('depth-alarm');
    expect(html).toContain('Shallow water: depth below the alarm threshold');
    expect(html).toContain('Shallow');
  });

  it('warns the SOG readout when the fix is lost but the speed path is still fresh', () => {
    const props = baseProps();
    expect(props.vessel.sogStale).toBe(false);
    const html = body({ ...props, fixStale: true });
    const start = html.indexOf('sog-readout');
    expect(html.slice(start, html.indexOf('</span>', start))).toContain('fix-lost');
    expect(html).toContain('No GPS fix');
  });

  it('leaves the reconnecting readout out of the live regions the conn dot already covers', () => {
    const html = body({
      ...baseProps(),
      connectionLabel: 'Reconnecting…',
      connectionPhase: 'reconnecting',
    });
    const reconnect = html.slice(0, html.indexOf('Reconnect</button>'));
    expect(reconnect).toContain('Reconnecting…');
    // One live region for the phase: the always-mounted dot, whose visually-hidden label is the
    // only copy of connectionLabel inside a role="status".
    expect(reconnect.match(/role="status"/g) ?? []).toHaveLength(1);
  });

  it('replaces a stale depth with an explicit unavailable state', () => {
    const store = new SignalKStore();
    const vesselClock = $state({ now: 20_000 });
    const vessel = new OwnVessel(store, vesselClock);
    store.applyFrame({
      self: new Map([['environment.depth.belowTransducer', 4]]) as SKFrame['self'],
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    const props = baseProps();
    const html = body({ ...props, vessel });
    expect(html).toContain('Depth stale');
    expect(html).toContain('Depth data is stale');
    expect(html).not.toContain('>4.0<');
  });
});
