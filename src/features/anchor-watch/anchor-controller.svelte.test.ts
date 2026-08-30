import { describe, expect, it, vi } from 'vitest';
import type { AnchorDegradedCause, AnchorWatch } from '$entities/anchor';
import type { OwnVessel } from '$entities/vessel';
import type { GatedAlarm } from '$shared/audio';
import { createAnchorController } from './anchor-controller.svelte';

interface AnchorFake {
  degradedCause: AnchorDegradedCause | undefined;
  dragging: boolean;
  acknowledged: boolean;
  blindAlarm: boolean;
  blindAcknowledged: boolean;
}

function controllerWith(overrides: Partial<AnchorFake>) {
  const anchor = {
    degradedCause: undefined,
    dragging: false,
    acknowledged: false,
    blindAlarm: false,
    blindAcknowledged: false,
    mode: 'client',
    updateFix: vi.fn(),
    ...overrides,
  } as unknown as AnchorWatch;
  return createAnchorController({
    origin: 'http://sk',
    getToken: () => undefined,
    anchor,
    vessel: { position: undefined, positionStale: false } as unknown as OwnVessel,
    anchorAlarm: { update: vi.fn() } as unknown as GatedAlarm,
    serverHasAnchorApi: () => false,
    writeBlocked: () => false,
    getBattery: undefined,
  });
}

describe('createAnchorController', () => {
  it('announces a client fix loss as dead drag detection', () => {
    expect(controllerWith({ degradedCause: 'fix-lost' }).anchorAlert).toBe(
      'Anchor watch degraded: no GPS fix, so drag detection has stopped.',
    );
  });

  it('words a held server-stale window as a reconnect, never a GPS loss', () => {
    expect(controllerWith({ degradedCause: 'server-stale' }).anchorAlert).toBe(
      'Anchor watch state is stale: reconnecting to the server.',
    );
  });

  it('words a lost server link as the link being down, never a GPS loss', () => {
    expect(controllerWith({ degradedCause: 'link-lost' }).anchorAlert).toBe(
      'Anchor watch degraded: connection to the server lost, so its drag alarm cannot reach this display.',
    );
  });

  it('exposes no battery warning without a Battery Status API', () => {
    const controller = controllerWith({});
    expect(controller.batteryWarning).toBeUndefined();
    expect(controller.batteryNote).toBeUndefined();
  });

  it('announces a drag only while unacknowledged, and stays quiet otherwise', () => {
    expect(controllerWith({ dragging: true }).anchorAlert).toBe(
      'Anchor alarm: the boat is dragging.',
    );
    expect(controllerWith({ dragging: true, acknowledged: true }).anchorAlert).toBe('');
    expect(controllerWith({}).anchorAlert).toBe('');
  });
});
