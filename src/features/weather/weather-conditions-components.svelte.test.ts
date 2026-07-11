import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { UnitsStore } from '$entities/units';
import ConditionsBlock from './ConditionsBlock.svelte';
import ForecastList from './ForecastList.svelte';

const units = new UnitsStore();

describe('weather condition displays', () => {
  it('shows observation age, stale wording, and useful provider fields', () => {
    const html = render(ConditionsBlock, {
      props: {
        current: {
          timeMs: Date.parse('2026-06-03T12:00:00Z'),
          humidityFraction: 0.8,
          dewPointK: 285,
          feelsLikeK: 290,
          precipitationMm: 2,
          precipitationType: 'Rain',
          currentSpeedMs: 0.5,
          uvIndex: 4,
        },
        observed: true,
        stale: true,
        cached: true,
        observationAgeMs: 75 * 60_000,
        units,
      },
    }).body;
    expect(html).toContain('1 h 15 min ago');
    expect(html).toContain('cached, refresh failed');
    expect(html).toContain('Humidity');
    expect(html).toContain('Dew point');
    expect(html).toContain('Feels like');
    expect(html).toContain('Current');
    expect(html).toContain('UV index');
  });

  it('shows enhanced forecast fields, provenance, and risk cues', () => {
    const html = render(ForecastList, {
      props: {
        forecast: [
          {
            timeMs: Date.parse('2026-06-03T15:00:00Z'),
            windMs: 18,
            gustMs: 22,
            pressurePa: 100_000,
            waveHeightM: 2,
            currentSpeedMs: 0.5,
            visibilityM: 800,
            provenance: 'mixed',
            riskCues: ['Gale-force wind', 'Dense fog'],
          },
        ],
        horizonH: 6,
        units,
      },
    }).body;
    expect(html).toContain('gust');
    expect(html).toContain('Waves');
    expect(html).toContain('Visibility');
    expect(html).toContain('Gale-force wind');
    expect(html).toContain('mixed');
  });
});
