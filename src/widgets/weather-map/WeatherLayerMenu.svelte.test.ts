import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { LayerListItem } from '$shared/map';
import WeatherLayerMenu from './WeatherLayerMenu.svelte';

function item(overrides: Partial<LayerListItem> = {}): LayerListItem {
  return {
    id: 'weather-pressure',
    title: 'Pressure',
    description: 'Barometric pressure contours across the area.',
    visible: false,
    opacity: 1,
    supportsOpacity: true,
    pinned: false,
    band: 'weather',
    available: true,
    ...overrides,
  };
}

describe('WeatherLayerMenu', () => {
  it('exposes each layer description as a tooltip and accessible description', () => {
    const { body } = render(WeatherLayerMenu, {
      props: {
        open: true,
        fills: [],
        overlays: [item()],
        provenance: undefined,
        onToggle: () => {},
        onClose: () => {},
      },
    });

    expect(body).toContain('title="Barometric pressure contours across the area."');
    expect(body).toContain('aria-describedby="weather-pressure-weather-description"');
    expect(body).toContain('Barometric pressure contours across the area.');
  });
});
