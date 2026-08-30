import { describe, expect, it } from 'vitest';
import { weatherLegend } from './legend';

describe('weatherLegend', () => {
  it('builds a wind speed gradient with whole-knot end labels', () => {
    const legend = weatherLegend('weather-wind', 'day', 'metric');
    expect(legend?.title).toMatch(/wind/i);
    expect(legend?.gradient).toMatch(/linear-gradient/);
    expect(legend?.lowLabel).toBe('0');
    expect(legend?.highLabel).toBe('50');
  });

  it('keeps the wind legend in knots under imperial: nautical units are unconditional', () => {
    const legend = weatherLegend('weather-wind', 'day', 'imperial');
    expect(legend?.title).toBe('Wind (kn)');
    expect(legend?.highLabel).toBe('50');
  });

  it('builds a single isobar swatch for pressure', () => {
    const legend = weatherLegend('weather-pressure', 'day', 'metric');
    expect(legend?.swatches).toHaveLength(1);
    expect(legend?.gradient).toBeUndefined();
  });

  it('keeps the isobar legend in hPa under imperial: isobars are conventionally hectopascals', () => {
    const legend = weatherLegend('weather-pressure', 'day', 'imperial');
    expect(legend?.swatches?.[0]?.label).toMatch(/hPa/);
  });

  it('builds gradients for waves, precipitation, and cloud', () => {
    for (const id of ['weather-waves', 'weather-precip', 'weather-cloud']) {
      expect(weatherLegend(id, 'day', 'metric')?.gradient).toMatch(/linear-gradient/);
    }
  });

  it('labels waves in meters with tenths under metric', () => {
    const legend = weatherLegend('weather-waves', 'day', 'metric');
    expect(legend?.title).toBe('Waves (m)');
    expect(legend?.lowLabel).toBe('0.5');
    expect(legend?.highLabel).toBe('9.0');
  });

  it('labels waves in whole feet under imperial', () => {
    const legend = weatherLegend('weather-waves', 'day', 'imperial');
    expect(legend?.title).toBe('Waves (ft)');
    expect(legend?.lowLabel).toBe('2');
    expect(legend?.highLabel).toBe('30');
  });

  it('labels rain in mm/h under metric and in/h under imperial', () => {
    const metric = weatherLegend('weather-precip', 'day', 'metric');
    expect(metric?.title).toBe('Rain (mm/h)');
    expect(metric?.highLabel).toBe('40.0');
    const imperial = weatherLegend('weather-precip', 'day', 'imperial');
    expect(imperial?.title).toBe('Rain (in/h)');
    expect(imperial?.highLabel).toBe('1.57');
  });

  it('builds a discrete intensity legend for the radar, honest about the nowcast', () => {
    const legend = weatherLegend('weather-radar', 'day', 'metric');
    expect(legend?.title).toMatch(/radar/i);
    expect(legend?.swatches?.length).toBeGreaterThan(1);
    // "live radar" would overstate the extrapolated newest frames.
    expect(legend?.note).toMatch(/nowcast/);
  });

  it('states the radar coverage bound so offshore silence never reads as no rain', () => {
    const legend = weatherLegend('weather-radar', 'day', 'metric');
    expect(legend?.coverageNote).toMatch(/land-based/i);
    expect(legend?.coverageNote).toMatch(/no data, not no rain/);
  });

  it('carries no coverage bound on the globally modeled layers', () => {
    for (const id of [
      'weather-wind',
      'weather-pressure',
      'weather-waves',
      'weather-precip',
      'weather-cloud',
    ]) {
      expect(weatherLegend(id, 'day', 'metric')?.coverageNote).toBeUndefined();
    }
  });

  it('labels cloud cover in whole percent', () => {
    expect(weatherLegend('weather-cloud', 'day', 'metric')?.highLabel).toBe('100');
  });

  it('returns undefined for an unknown layer', () => {
    expect(weatherLegend('weather-unknown', 'day', 'metric')).toBeUndefined();
  });
});
