import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import type { AuthController } from '$shared/signalk';
import AnchorPanel from './AnchorPanel.svelte';

function renderPanel(mode: 'imperial' | 'metric'): string {
  return render(AnchorPanel, {
    props: {
      auth: { writeBlocked: false } as AuthController,
      anchor: {
        watching: false,
        fixLost: false,
        distanceMeters: undefined,
        mode: 'off',
        radiusMeters: undefined,
        preferredRadiusMeters: 30,
        degraded: false,
        dragging: false,
      } as AnchorWatch,
      vessel: {
        position: { latitude: 42, longitude: -83 },
        positionStale: false,
        depthMeters: undefined,
      } as OwnVessel,
      units: { mode } as UnitsStore,
      onDrop: vi.fn(),
      onRaise: vi.fn(),
      onSetRadius: vi.fn(),
      onClose: vi.fn(),
    },
  }).body;
}

describe('AnchorPanel', () => {
  it('renders the resolved watch-radius unit in the accessible name', () => {
    expect(renderPanel('metric')).toContain('aria-label="Watch radius in meters"');
    expect(renderPanel('imperial')).toContain('aria-label="Watch radius in feet"');
  });
});
