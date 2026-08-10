import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import type { DepthReading, OwnVessel } from '$entities/vessel';
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
  extras: { anchor?: Record<string, unknown>; audioBlocked?: boolean } = {},
): string {
  return render(AnchorPanel, {
    props: {
      auth,
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
      } as OwnVessel,
      units: { mode } as UnitsStore,
      audioBlocked: extras.audioBlocked ?? false,
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

    expect(body).toContain('Server anchor changes need a write token.');
    expect(body).toContain('Request read/write access');
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
  });

  it('keeps the reconnect blip (degraded without a cause yet) off the status line', () => {
    const body = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: { watching: true, mode: 'server', degradedCause: undefined },
    });
    expect(body).toContain('Watching on the server.');
    expect(body).not.toContain('status--alarm');
  });

  it('warns that alarms are visual-only while audio is blocked', () => {
    const blocked = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, { audioBlocked: true });
    expect(blocked).toContain('Alarm sound is off');
    expect(renderPanel('metric')).not.toContain('Alarm sound is off');
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
});
