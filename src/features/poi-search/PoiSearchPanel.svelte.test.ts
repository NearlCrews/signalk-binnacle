import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import PoiSearchPanel from './PoiSearchPanel.svelte';

const place = {
  id: 'p1',
  name: 'Harbor Marina',
  position: { latitude: 42.6, longitude: -83.5 },
  category: 'marina' as const,
  source: 'Harbor Guide',
};

function renderPanel(overrides: Record<string, unknown> = {}): string {
  return render(PoiSearchPanel, {
    props: {
      pois: [],
      vessel: { position: undefined, positionStale: false } as unknown as OwnVessel,
      units: { mode: 'metric' } as UnitsStore,
      viewState: { phase: 'ready', offline: false },
      onSelect: vi.fn(),
      onHover: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    },
  }).body;
}

describe('PoiSearchPanel', () => {
  it('distinguishes an offline cache miss from a provider empty result', () => {
    expect(renderPanel({ viewState: { phase: 'ready', offline: true } })).toContain(
      'No places are available from cache for this view.',
    );
    expect(renderPanel()).toContain('No places were returned for this view.');
  });

  it('reports a refresh while retaining current rows', () => {
    const body = renderPanel({ pois: [place], viewState: { phase: 'loading', offline: false } });
    expect(body).toContain('Refreshing places for this chart view...');
    expect(body).toContain('Harbor Marina');
  });

  it('explains why distance and bearing are absent without a fresh fix', () => {
    expect(renderPanel({ pois: [place] })).toContain('Distance and bearing need a fresh GPS fix.');
  });
});
