import { describe, expect, it, vi } from 'vitest';
import type { AnchorDegradedCause, AnchorWatch } from '$entities/anchor';
import type { OwnVessel } from '$entities/vessel';
import type { GatedAlarm } from '$shared/audio';
import { createAnchorController } from './anchor-controller.svelte';

interface AnchorFake {
  degradedCause: AnchorDegradedCause | undefined;
  dragging: boolean;
  acknowledged: boolean;
  fixLostAlarm: boolean;
  fixLostAcknowledged: boolean;
}

function controllerWith(overrides: Partial<AnchorFake>) {
  const anchor = {
    degradedCause: undefined,
    dragging: false,
    acknowledged: false,
    fixLostAlarm: false,
    fixLostAcknowledged: false,
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

  it('announces a drag only while unacknowledged, and stays quiet otherwise', () => {
    expect(controllerWith({ dragging: true }).anchorAlert).toBe(
      'Anchor alarm: the boat is dragging.',
    );
    expect(controllerWith({ dragging: true, acknowledged: true }).anchorAlert).toBe('');
    expect(controllerWith({}).anchorAlert).toBe('');
  });
});
