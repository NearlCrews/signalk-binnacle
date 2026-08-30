import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnchorWatch } from '$entities/anchor';
import type { TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import type { DepthReading, OwnVessel } from '$entities/vessel';
import type { AlarmAudioState } from '$shared/audio';
import type { AuthController } from '$shared/signalk';
import AnchorPanel from './AnchorPanel.svelte';

const NO_DEPTH: DepthReading = {
  meters: undefined,
  source: undefined,
  path: 'environment.depth.belowTransducer',
  stale: false,
};

function renderPanel(
  mode: 'imperial' | 'metric',
  anchorDepth: DepthReading = NO_DEPTH,
  safetyDepth: DepthReading = NO_DEPTH,
  auth: AuthController = { writeBlocked: false } as AuthController,
  extras: {
    anchor?: Record<string, unknown>;
    audioState?: AlarmAudioState;
    batteryNote?: string;
    vessel?: Record<string, unknown>;
    tides?: Record<string, unknown>;
  } = {},
): string {
  return render(AnchorPanel, {
    props: {
      auth,
      batteryNote: extras.batteryNote,
      tides: extras.tides as unknown as TidesStore | undefined,
      anchor: {
        watching: false,
        fixLost: false,
        distanceMeters: undefined,
        mode: 'off',
        radiusMeters: undefined,
        preferredRadiusMeters: 30,
        degradedCause: undefined,
        dragging: false,
        ...extras.anchor,
      } as unknown as AnchorWatch,
      vessel: {
        position: { latitude: 42, longitude: -83 },
        positionStale: false,
        anchorDepth,
        safetyDepth,
        lengthMeters: undefined,
        ...extras.vessel,
      } as unknown as OwnVessel,
      units: { mode } as UnitsStore,
      audioState: extras.audioState ?? 'ready',
      onDrop: vi.fn(),
      onRaise: vi.fn(),
      onSetRadius: vi.fn(),
      onClose: vi.fn(),
    },
  }).body;
}

function blockedAuth(upgrading: boolean): AuthController {
  return {
    writeBlocked: true,
    upgrading,
    requestWriteAccess: vi.fn(),
  } as unknown as AuthController;
}

describe('AnchorPanel', () => {
  it('renders the resolved watch-radius unit in the accessible name', () => {
    expect(renderPanel('metric')).toContain('aria-label="Watch radius in meters"');
    expect(renderPanel('imperial')).toContain('aria-label="Watch radius in feet"');
  });

  it('names the depth reference beside the reading', () => {
    const html = renderPanel('metric', {
      meters: 9,
      source: 'surface',
      path: 'environment.depth.belowSurface',
      stale: false,
    });
    expect(html).toContain('Depth (Surface)');
    expect(html).toContain('title="Depth below the surface"');
    expect(html).toContain('9.0');
  });

  it('holds out no depth value once the reading goes stale', () => {
    const html = renderPanel('metric', {
      meters: 9,
      source: 'surface',
      path: 'environment.depth.belowSurface',
      stale: true,
    });
    expect(html).toContain('Depth (Surface)');
    expect(html).not.toContain('9.0');
  });

  it('omits the depth row until a depth source reports', () => {
    expect(renderPanel('metric')).not.toContain('Depth (');
  });

  it('offers the read/write request while server anchor changes are blocked', () => {
    const body = renderPanel('metric', NO_DEPTH, NO_DEPTH, blockedAuth(false));

    expect(body).toContain('Server anchor changes need read and write access.');
    expect(body).toContain('Request read and write access');
  });

  it('rests the request control while a request is outstanding', () => {
    expect(renderPanel('metric', NO_DEPTH, NO_DEPTH, blockedAuth(true))).toMatch(
      /<button[^>]+disabled[^>]*>\s*Requesting access/,
    );
  });

  it('words the two degraded causes apart and alarms the status line for both', () => {
    const fixLost = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: {
        watching: true,
        mode: 'client',
        fixLost: true,
        immediateDegradedCause: 'fix-lost',
      },
    });
    expect(fixLost).toContain('Warning: GPS fix lost. Browser drag detection has stopped.');
    expect(fixLost).toContain('status--alarm');

    // The panel words server-stale from the ungraced immediate cause, before the live region's
    // grace has held: the reassuring mode text must not stand in for untrusted geometry.
    const stale = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: { watching: true, mode: 'server', immediateDegradedCause: 'server-stale' },
    });
    expect(stale).toContain('Anchor watch state is stale: reconnecting to the server.');
    expect(stale).toContain('status--alarm');

    // A down stream on a server watch is named as the link, never a GPS loss, and it is worded
    // from the ungraced immediate cause too.
    const linkLost = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: { watching: true, mode: 'server', immediateDegradedCause: 'link-lost' },
    });
    expect(linkLost).toContain(
      'Warning: server connection lost. The server watch cannot alert this display.',
    );
    expect(linkLost).toContain('status--alarm');
  });

  it('shows the battery warning while this browser carries the watch', () => {
    const body = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: { watching: true, mode: 'client' },
      batteryNote: 'Battery low (18%). This browser carries the anchor watch.',
    });
    expect(body).toContain('Battery low (18%)');
    expect(renderPanel('metric')).not.toContain('Battery low');
  });

  it('keeps the reconnect blip (degraded without a cause yet) off the status line', () => {
    const body = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: { watching: true, mode: 'server', degradedCause: undefined },
    });
    expect(body).toContain('Watching on the server.');
    expect(body).not.toContain('status--alarm');
  });

  it('warns that alarms are visual-only while audio is blocked', () => {
    const blocked = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, { audioState: 'blocked' });
    expect(blocked).toContain('Alarm sound is off');
    expect(renderPanel('metric')).not.toContain('Alarm sound is off');
  });

  it('states a failed or unsupported audio device, which the status strip no longer reports', () => {
    const failed = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, { audioState: 'failed' });
    expect(failed).toContain('failed to start');
    const unsupported = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      audioState: 'unsupported',
    });
    expect(unsupported).toContain('Audible alarms are unavailable');
    // Terminal and gesture-recoverable states must not be flattened into one message.
    expect(unsupported).not.toContain('Any tap');
  });

  it('explains the missing depth row on a keel-only sounder', () => {
    const keelOnly: DepthReading = {
      meters: 4,
      source: 'keel',
      path: 'environment.depth.belowKeel',
      stale: false,
    };
    const body = renderPanel('metric', NO_DEPTH, keelOnly);
    expect(body).not.toContain('Depth (');
    expect(body).toContain('The sounder publishes keel depth only');
  });

  it('offers the rode helper with unit-resolved accessible names', () => {
    const metric = renderPanel('metric');
    expect(metric).toContain('Suggest a radius from the rode');
    expect(metric).toContain('aria-label="Rode paid out in meters"');
    expect(renderPanel('imperial')).toContain('aria-label="Rode paid out in feet"');
    expect(metric).toContain('Enter the values above to get a suggested radius.');
  });

  it('asks for the boat length only when the vessel does not declare one', () => {
    expect(renderPanel('metric')).toContain('Boat length');
    expect(
      renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, { vessel: { lengthMeters: 12.8 } }),
    ).not.toContain('Boat length');
  });

  it('names the depth source feeding the rode math and that depth follows the tide', () => {
    const live = renderPanel('metric', {
      meters: 9,
      source: 'surface',
      path: 'environment.depth.belowSurface',
      stale: false,
    });
    expect(live).toContain('from the Surface sounding');
    expect(live).toContain('Depth changes with the tide');
    expect(live).not.toContain('Depth at the anchor in');
  });

  it('falls back to a manual depth field when no usable sounding exists', () => {
    const manual = renderPanel('metric');
    expect(manual).toContain('aria-label="Depth at the anchor in meters"');
    expect(manual).toContain('No usable depth sounding, so enter the depth by hand.');
  });

  it('holds a stale sounding out of the rode math and asks for a manual depth', () => {
    const stale = renderPanel('metric', {
      meters: 9,
      source: 'surface',
      path: 'environment.depth.belowSurface',
      stale: true,
    });
    expect(stale).toContain('aria-label="Depth at the anchor in meters"');
    expect(stale).not.toContain('from the Surface sounding');
  });

  it('omits the tide section until the host wires the tides store', () => {
    expect(renderPanel('metric')).not.toContain('Nearby tide prediction');
  });

  it('summarizes the nearest station prediction with its distance honesty line', () => {
    const now = Date.now();
    const body = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      tides: {
        status: 'ready',
        tide: {
          station: { id: '8654321', name: 'Point Lookout', latitude: 42, longitude: -83 },
          distanceMeters: 850,
          events: [
            { timeMs: now + 3_600_000, heightMeters: 2.1, kind: 'high' },
            { timeMs: now + 7_200_000, heightMeters: 0.4, kind: 'low' },
          ],
        },
      },
    });
    expect(body).toContain('Nearby tide prediction');
    expect(body).toContain('Point Lookout');
    expect(body).toContain('850 m away');
    expect(body).toContain('Next high');
    expect(body).toContain('2.1');
    expect(body).toContain('Next low');
    expect(body).toContain('0.4');
    expect(body).toContain('Predictions come from Point Lookout');
    expect(body).toContain('The tide here can differ');
  });

  it('states coverage honestly when no station is near', () => {
    const body = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      tides: { status: 'no-coverage', tide: undefined },
    });
    expect(body).toContain('No tide station nearby. NOAA tide predictions cover US waters only.');
  });

  it('words the loading, error, and idle tide states apart', () => {
    const loading = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      tides: { status: 'loading', tide: undefined },
    });
    expect(loading).toContain('Loading tide predictions…');
    const failed = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      tides: { status: 'error', tide: undefined },
    });
    expect(failed).toContain('Tide predictions did not load.');
    const idle = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      tides: { status: 'idle', tide: undefined },
    });
    expect(idle).toContain('Tide predictions have not loaded for this view yet.');
  });
});
