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

// The opening tag of the first element carrying a class, throwing when absent.
function openingTag(html: string, className: string): string {
  const at = html.indexOf(className);
  if (at < 0) throw new Error(`No element with ${className}`);
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1);
}

describe('StatusStrip depth alarm', () => {
  it('carries no sound-off notice unless App reports an armed watch that cannot sound', () => {
    expect(body(baseProps())).not.toContain('sound-off-notice');
    const blocked = body({ ...baseProps(), soundOff: 'blocked' });
    expect(blocked).toContain('Alarm sound off');
    expect(blocked).toContain('>Enable</button>');
  });

  it('offers a tap only where a tap can bring the alarm sound back', () => {
    const failed = body({ ...baseProps(), soundOff: 'failed' });
    expect(failed).toContain('Alarm sound failed');
    expect(failed).toContain('>Try again</button>');
    // No Web Audio at all: the notice explains on a tap and offers no action that cannot work.
    const unsupported = body({ ...baseProps(), soundOff: 'unsupported' });
    expect(unsupported).toContain('Alarm sound unavailable');
    expect(unsupported).not.toContain('>Enable</button>');
    expect(unsupported).not.toContain('>Try again</button>');
    expect(openingTag(unsupported, 'sound-off-notice')).toMatch(/^<button/);
  });

  it('shows the toolbar clock as local time, not UTC', () => {
    const html = body(baseProps());
    expect(html).toContain('title="Local time"');
    expect(html).not.toContain('UTC time');
    expect(html).not.toContain('UTC</b>');
  });

  it('does not mark the Depth readout when the shallow alarm is not sounding', () => {
    const html = body(baseProps());
    expect(html).not.toContain('data-cell--alarm');
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
    expect(openingTag(html, 'depth-readout')).toContain('data-cell--alarm');
    expect(html).toContain('Shallow water: depth below the alarm threshold');
    expect(html).toContain('Shallow');
  });

  it('warns the SOG readout when the fix is lost but the speed path is still fresh', () => {
    const props = baseProps();
    expect(props.vessel.sogStale).toBe(false);
    const html = body({ ...props, fixStale: true });
    expect(openingTag(html, 'sog-readout')).toContain('data-cell--warning');
    expect(openingTag(html, 'cog-readout')).toContain('data-cell--warning');
    expect(html).toContain('No GPS fix');
  });

  it('leaves the reconnecting readout out of the live regions the conn dot already covers', () => {
    const html = body({
      ...baseProps(),
      connectionLabel: 'Reconnecting…',
      connectionPhase: 'reconnecting',
    });
    const notice = html.slice(0, html.indexOf('Reconnect</button>'));
    expect(notice).toContain('Reconnecting…');
    // One live region for the phase: the always-mounted dot, whose visually-hidden label is the
    // only copy of connectionLabel inside a role="status".
    expect(notice).not.toContain('role="status"');
    expect(html.match(/role="status"/g) ?? []).toHaveLength(1);
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
    expect(html).toContain('>Paused<');
    expect(html).toContain('Depth data is stale');
    expect(html).not.toContain('>4.0<');
  });

  it('names a paused shallow watch instead of a bare depth placeholder', () => {
    // Never-had-a-source keeps the plain label: nothing was ever watching, so there is no pause
    // to name, and the phone footer must not permanently wrap for a boat with no sounder. The
    // title still explains that the watch cannot monitor.
    const noSource = body({ ...baseProps(), shallowState: 'no-source' as const });
    expect(noSource).toContain('shallow watch cannot monitor');
    expect(noSource).not.toContain('>Paused<');
    // A paused watch says so in place of the value, in the caution voice; the dashed value and
    // the datum tag are dropped, and a tap names the cause.
    const stale = body({ ...baseProps(), shallowState: 'stale' as const });
    expect(stale).toContain('>Paused<');
    expect(stale).toContain('the shallow watch is paused');
    expect(openingTag(stale, 'depth-readout')).toContain('data-cell--warning');
    expect(stale).not.toContain('Xducer');
    const noReading = body({ ...baseProps(), shallowState: 'no-reading' as const });
    expect(noReading).toContain('>Paused<');
    expect(noReading).toContain('streaming unusable readings');
    expect(body(baseProps())).not.toContain('>Paused<');
  });

  it('says Waiting for GPS when connected with no position ever received', () => {
    const waiting = body({ ...baseProps(), gpsNeverReceived: true });
    expect(waiting).toContain('Waiting for GPS');
    expect(waiting).toContain('Data Browser');
    // The had-then-lost case wins the same slot with its own wording.
    const lost = body({ ...baseProps(), gpsNeverReceived: true, fixStale: true });
    expect(lost).toContain('No GPS fix');
    expect(lost).not.toContain('Waiting for GPS');
    expect(body(baseProps())).not.toContain('Waiting for GPS');
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

  it('subordinates the consequence chips while the link itself is the failure, radar excluded', () => {
    const down = body({
      ...baseProps(),
      connectionLabel: 'Not connected',
      connectionPhase: 'closed',
      fixStale: true,
      radarHealth: { state: 'stale' } as const,
    });
    // The dashed SOG and the No GPS fix chip dim; the radar chip rides its own transport and
    // must never dim with the Signal K link.
    const sog = down.slice(down.indexOf('sog-readout'));
    expect(sog.slice(0, sog.indexOf('>'))).toContain('subordinate');
    expect(openingTag(down, 'fix-notice')).toContain('subordinate');
    const radar = down.indexOf('Radar stale');
    expect(down.slice(down.lastIndexOf('<button', radar), radar)).not.toContain('subordinate');
    // A healthy link never subordinates anything.
    expect(body({ ...baseProps(), fixStale: true })).not.toContain('subordinate');
  });

  it('renders the anchor chip as a door to the panel, named by its live content', () => {
    const props = baseProps();
    props.anchor.dropLocal({ latitude: 60, longitude: 24 }, 40);
    const html = body({ ...props, onOpenAnchor: () => {} });
    expect(openingTag(html, 'anchor-readout')).toMatch(/^<button/);
    expect(html).toContain('Opens Anchor watch');
    expect(html).not.toContain('aria-label="Open anchor watch"');
  });

  it('offers a Help action on the Waiting for GPS chip when the host wires one', () => {
    const withHelp = body({ ...baseProps(), gpsNeverReceived: true, onOpenHelp: () => {} });
    expect(withHelp).toContain('Waiting for GPS');
    expect(withHelp).toContain('>Help</button>');
    const without = body({ ...baseProps(), gpsNeverReceived: true });
    expect(without).not.toContain('>Help</button>');
  });

  it('renders the explanatory chips as buttons carrying their titles, with no new live regions', () => {
    const html = body({ ...baseProps(), aisCount: 3, connectionPhase: 'open' });
    expect(openingTag(html, 'slot-ais')).toMatch(/^<button[^>]*data-cell/);
    expect(openingTag(html, 'slot-ais')).toContain('AIS targets being watched for collision risk');
    // The conn dot keeps its single live region inside the button.
    expect(html.match(/role="status"/g) ?? []).toHaveLength(1);
  });
});

describe('StatusStrip alerts chip', () => {
  it('stays hidden with no caution-grade alerts', () => {
    expect(body(baseProps())).not.toContain('alerts-notice');
  });

  it('counts alerts in words and names its door, the visible words leading the name', () => {
    expect(body({ ...baseProps(), alertCount: 1, onOpenAlarms: () => {} })).toContain('1 alert<');
    const html = body({ ...baseProps(), alertCount: 3, onOpenAlarms: () => {} });
    expect(html).toContain('3 alerts<');
    expect(html).toContain('aria-label="3 alerts, open Alarms"');
  });
});

describe('StatusStrip bar grid', () => {
  it('shows nothing on the caution line while nothing is wrong', () => {
    expect(body(baseProps())).not.toContain('class="notice');
  });

  it('says Last fix without a dangling separator when the fix has no age', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame({
      self: new Map([
        ['navigation.position', { latitude: 42.6154, longitude: -83.5166 }],
      ]) as SKFrame['self'],
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    const html = body({ ...baseProps(), vessel, fixStale: true });
    expect(html).toMatch(/>Last fix( · \d+ (s|min) ago)?</);
    expect(html).not.toContain('Last fix · <');
  });

  it('sets each coordinate close to its hemisphere so the position fits two columns', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame({
      self: new Map([
        ['navigation.position', { latitude: 42.6154, longitude: -83.5166 }],
      ]) as SKFrame['self'],
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    const html = body({ ...baseProps(), vessel });
    expect(html).toContain('<b class="num">42.6154°</b>N</span>');
    expect(html).toContain('<b class="num">83.5166°</b>W</span>');
    expect(openingTag(html, 'position-readout')).toContain('data-cell--wide');
  });

  it('gives each optional readout its own spare column, so one appearing moves no other', () => {
    const orientation = {
      label: 'Course up (COG)',
      active: true,
      shown: 'Course up',
      reference: 'COG' as const,
    };
    const autopilot = { autopilotChip: { kind: 'standby' as const }, onOpenAutopilot: () => {} };
    const alone = body({ ...baseProps(), ...autopilot, orientation });
    expect(openingTag(alone, 'orientation-readout')).toContain('slot-extra-1');
    expect(openingTag(alone, 'ap-cell')).toContain('slot-extra-2');
    // The anchor watch takes the second column; the autopilot yields to the Time column rather
    // than pushing the chart cell aside.
    const props = baseProps();
    props.anchor.dropLocal({ latitude: 60, longitude: 24 }, 40);
    const all = body({ ...props, onOpenAnchor: () => {}, ...autopilot, orientation });
    expect(openingTag(all, 'orientation-readout')).toContain('slot-extra-1');
    expect(openingTag(all, 'anchor-readout')).toContain('slot-extra-2');
    expect(openingTag(all, 'ap-cell')).toContain('slot-extra-3');
  });

  it('makes the Chart cell the one-tap return to north up, naming its reference', () => {
    const html = body({
      ...baseProps(),
      orientation: { label: 'Course up (COG)', active: true, shown: 'Course up', reference: 'COG' },
      onResetOrientation: () => {},
    });
    expect(openingTag(html, 'orientation-readout')).toMatch(/^<button/);
    expect(html).toContain('Course up<');
    expect(html).toContain('· COG');
    expect(html).toContain(', return to north up');
    expect(html).not.toContain('orientation-notice');
  });

  it('says north up in the caution voice and names the fallback on the caution line', () => {
    const html = body({
      ...baseProps(),
      orientation: {
        label: 'North up (too slow for course up)',
        active: false,
        shown: 'North up',
      },
    });
    expect(openingTag(html, 'orientation-readout')).toContain('data-cell--warning');
    expect(html).toContain('North up<');
    expect(html).toContain('North up (too slow for course up)');
    // The shown mode is a live region, so the fallback is announced as well as drawn.
    expect(html).toMatch(/role="status" aria-live="polite">North up</);
  });
});
