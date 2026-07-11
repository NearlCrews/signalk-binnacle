import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { UnitsStore } from '$entities/units';
import ConditionsBlock from './ConditionsBlock.svelte';
import ForecastList from './ForecastList.svelte';

const units = { mode: 'metric' } as UnitsStore;

describe('ConditionsBlock', () => {
  it('shows observation age, stale wording, and high-value provider fields', () => {
    const { body } = render(ConditionsBlock, {
      props: {
        units,
        observed: true,
        stale: true,
        cached: true,
        observationAgeMs: 90 * 60_000,
        current: {
          timeMs: Date.parse('2026-06-11T12:00:00Z'),
          feelsLikeK: 294,
          dewPointK: 288,
          humidityFraction: 0.82,
          precipitationMm: 2,
          precipitationType: 'Rain',
          uvIndex: 5,
          currentSpeedMs: 0.5,
          currentDirectionRad: 1,
          sunriseMs: Date.parse('2026-06-11T10:00:00Z'),
          sunsetMs: Date.parse('2026-06-12T00:00:00Z'),
        },
      },
    });
    expect(body).toContain('1 h 30 min ago');
    expect(body).toContain('stale');
    expect(body).toContain('cached, refresh failed');
    for (const label of ['Feels like', 'Dew point', 'Humidity', 'Rain', 'UV index', 'Current']) {
      expect(body).toContain(label);
    }
    expect(body).toContain('Sunrise');
    expect(body).toContain('Sunset');
  });
});

describe('ForecastList', () => {
  it('shows gust, pressure, waves, current, visibility, provenance, and official-warning posture', () => {
    const { body } = render(ForecastList, {
      props: {
        units,
        horizonH: 6,
        forecast: [
          {
            timeMs: Date.parse('2026-06-11T18:00:00Z'),
            windMs: 20,
            fromRad: 1,
            gustMs: 25,
            pressurePa: 99_500,
            waveHeightM: 3,
            currentSpeedMs: 0.6,
            visibilityM: 800,
            provenance: 'mixed',
            riskCues: ['Storm-force wind', 'Dense fog'],
          },
        ],
      },
    });
    for (const text of ['gust', 'Waves', 'Current', 'Visibility', 'mixed', 'Storm-force wind']) {
      expect(body).toContain(text);
    }
    expect(body).toContain('not official warnings');
  });
});
