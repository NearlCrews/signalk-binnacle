import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { MobStore } from '$entities/mob';
import type { UnitsStore } from '$entities/units';
import MobStrip from './MobStrip.svelte';

function renderStrip(publishWarning?: string): string {
  return render(MobStrip, {
    props: {
      mob: {
        active: true,
        acknowledged: false,
        position: undefined,
        bearingRad: undefined,
        distanceMeters: undefined,
        elapsedSeconds: undefined,
        markEpochMs: undefined,
      } as unknown as MobStore,
      units: { mode: 'metric' } as UnitsStore,
      publishWarning,
      onSteer: vi.fn(),
      onCancel: vi.fn(),
    },
  }).body;
}

describe('MobStrip', () => {
  it('shows the boat-wide publish warning while the controller reports one', () => {
    const warning = 'The boat-wide alarm may not have reached the server.';
    const body = renderStrip(warning);
    expect(body).toContain(warning);
    expect(body).toContain('alert-note');
  });

  it('carries no warning row otherwise', () => {
    expect(renderStrip()).not.toContain('alert-note');
  });
});
