import type { ComponentProps } from 'svelte';
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
  const anchor = new AnchorWatch(store, vessel, undefined, createFakeStorage());
  return {
    connectionLabel: 'Connected',
    streamError: false,
    dataStalled: false,
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
    audioState: 'ready' as import('$shared/audio').AlarmAudioState,
    onEnableSound: () => {},
    pinnedActions: [],
    clock,
    onReconnect: () => {},
  };
}

// Rendered to an SSR HTML string (the suite runs in the node environment, no DOM), enough to pin
// the Depth readout's alarm styling on and off, matching ChartLockerStatus's own SSR-string
// verification pattern for a presentational strip component.
function body(props: ComponentProps<typeof StatusStrip>): string {
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

  it('shows the stalled-data readout with a reconnect action while the socket is open', () => {
    const html = body({
      ...baseProps(),
      connectionLabel: 'Connected, no data',
      dataStalled: true,
    });
    expect(html).toContain('Connected, no data');
    expect(html).toContain('Reconnect</button>');
    // The chip is the sighted half only; the conn dot's live region announces the label once.
    expect(html.match(/role="status"/g) ?? []).toHaveLength(1);
    expect(html).toContain('conn--down');
  });

  it('keeps the stalled readout out of a healthy connected strip', () => {
    const html = body(baseProps());
    expect(html).not.toContain('Reconnect</button>');
    expect(html).not.toContain('conn--down');
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

  it('shows the sound-off chip with its enable action only while audio is blocked', () => {
    const blocked = body({ ...baseProps(), audioState: 'blocked' as const });
    expect(blocked).toContain('Sound off');
    expect(blocked).toContain('Enable');

    const healthy = body(baseProps());
    expect(healthy).not.toContain('Sound off');
    expect(healthy).not.toContain('Sound unavailable');
  });

  it('offers Retry for a failed audio setup instead of a dead Enable', () => {
    const failed = body({ ...baseProps(), audioState: 'failed' as const });
    expect(failed).toContain('Sound unavailable');
    expect(failed).toContain('Retry');
    expect(failed).not.toContain('>Enable<');
  });

  it('names a paused shallow watch instead of a bare depth placeholder', () => {
    const noSource = body({ ...baseProps(), shallowState: 'no-source' as const });
    expect(noSource).toContain('Depth unavailable, watch paused');
    expect(noSource).toContain('shallow watch cannot monitor');
    const stale = body({ ...baseProps(), shallowState: 'stale' as const });
    expect(stale).toContain('Depth stale, watch paused');
    const noReading = body({ ...baseProps(), shallowState: 'no-reading' as const });
    expect(noReading).toContain('Depth unavailable, watch paused');
    expect(body(baseProps())).not.toContain('watch paused');
  });

  it('keeps radar trouble visible with the radar panel closed, and quiet otherwise', () => {
    const stream = body({
      ...baseProps(),
      radarHealth: { state: 'failed', reason: 'stream' } as const,
    });
    expect(stream).toContain('Radar stream failed');
    const renderer = body({
      ...baseProps(),
      radarHealth: { state: 'failed', reason: 'renderer' } as const,
    });
    expect(renderer).toContain('Radar display failed');
    const stale = body({ ...baseProps(), radarHealth: { state: 'stale' } as const });
    expect(stale).toContain('Radar stale');
    expect(body(baseProps())).not.toContain('Radar');
  });

  it('states that audible alarms are unavailable with no action when unsupported', () => {
    const unsupported = body({ ...baseProps(), audioState: 'unsupported' as const });
    expect(unsupported).toContain('Sound unavailable');
    expect(unsupported).toContain('Audible alarms are unavailable on this display');
    expect(unsupported).not.toContain('>Enable<');
    expect(unsupported).not.toContain('>Retry<');
  });
});
