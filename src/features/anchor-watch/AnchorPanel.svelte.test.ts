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

function renderPanel(mode: 'imperial' | 'metric', anchorDepth: DepthReading = NO_DEPTH): string {
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
        anchorDepth,
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
});
