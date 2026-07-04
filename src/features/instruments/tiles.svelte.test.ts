import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { ZoneState } from '$shared/signalk';
import NumericTile from './NumericTile.svelte';
import type { TileReading } from './tile-catalog';
import WindTile from './WindTile.svelte';

// SSR-only suite (node environment, no DOM). Assertions are substring checks on the rendered body.

function numericBody(props: {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
}): string {
  return render(NumericTile, { props }).body;
}

function windBody(props: {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
}): string {
  return render(WindTile, { props }).body;
}

const LIVE: TileReading = { state: 'live', value: '7.4', unit: 'kn', siValue: 3.8 };
const STALE: TileReading = { state: 'stale', value: '6.1', unit: 'kn', siValue: 3.1 };
const NEVER: TileReading = { state: 'never', value: '---', unit: '' };
const PLACEHOLDER_READING: TileReading = { state: 'placeholder', value: '---', unit: 'kn' };

const GLOSS = 'No speed sensor';
const LABEL = 'SOG';
const normal: ZoneState = 'normal';

describe('NumericTile', () => {
  it('shows value and unit for a live reading', () => {
    const html = numericBody({ label: LABEL, reading: LIVE, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('7.4');
    expect(html).toContain('kn');
  });

  it('renders sensorGloss and hides value span when state is never', () => {
    const html = numericBody({ label: LABEL, reading: NEVER, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain(GLOSS);
    // The value string ('---') must not appear in a num span; the sensorGloss path is taken.
    // We verify the num wrapper is absent by checking no num class attribute is present.
    expect(html).not.toMatch(/class="[^"]*\bnum\b/);
  });

  it('renders value as-is for placeholder state', () => {
    const html = numericBody({
      label: LABEL,
      reading: PLACEHOLDER_READING,
      zone: normal,
      sensorGloss: GLOSS,
    });
    expect(html).toContain('---');
    expect(html).not.toContain(GLOSS);
  });

  it('adds tile--stale class when state is stale', () => {
    const html = numericBody({ label: LABEL, reading: STALE, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('tile--stale');
  });

  it('adds tile--alarm class for alarm zone', () => {
    const html = numericBody({
      label: LABEL,
      reading: LIVE,
      zone: 'alarm',
      sensorGloss: GLOSS,
    });
    expect(html).toContain('tile--alarm');
    expect(html).not.toContain('tile--warning');
  });

  it('adds tile--warning class for warning zone', () => {
    const html = numericBody({
      label: LABEL,
      reading: LIVE,
      zone: 'warning',
      sensorGloss: GLOSS,
    });
    expect(html).toContain('tile--warning');
    expect(html).not.toContain('tile--alarm');
  });

  it('carries no aria-live attribute', () => {
    const html = numericBody({ label: LABEL, reading: LIVE, zone: normal, sensorGloss: GLOSS });
    expect(html).not.toContain('aria-live');
  });

  it('appends referenceLabel to the caps-label when present', () => {
    const reading: TileReading = { ...LIVE, referenceLabel: 'M' };
    const html = numericBody({ label: 'HDG', reading, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('HDG (M)');
  });
});

describe('WindTile', () => {
  const WIND_LIVE: TileReading = {
    state: 'live',
    value: '12.3',
    unit: 'kn',
    siValue: 6.3,
    angleRad: Math.PI / 2,
  };

  it('renders an SVG with a needle rotated by angleRad', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: normal, sensorGloss: GLOSS });
    // deg = angleRad * 180 / Math.PI — compute the same way the component does.
    const expectedDeg = (WIND_LIVE.angleRad ?? 0) * (180 / Math.PI);
    expect(html).toContain(`rotate(${expectedDeg} 50 50)`);
  });

  it('marks the SVG as aria-hidden', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('aria-hidden="true"');
  });

  it('shows speed value and unit in the readable line', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('12.3');
    expect(html).toContain('kn');
  });

  it('shows formatted angle text beside speed', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: normal, sensorGloss: GLOSS });
    // angleRad = π/2 → starboard 90°, formatSignedAngleOr → 'S 90'
    expect(html).toContain('S 90');
  });

  it('renders sensorGloss and no SVG when state is never', () => {
    const neverWind: TileReading = { state: 'never', value: '---', unit: '' };
    const html = windBody({ label: 'AWS', reading: neverWind, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain(GLOSS);
    expect(html).not.toContain('<svg');
  });

  it('adds tile--stale class when state is stale', () => {
    const staleWind: TileReading = {
      state: 'stale',
      value: '8.0',
      unit: 'kn',
      siValue: 4.1,
      angleRad: 0,
    };
    const html = windBody({ label: 'AWS', reading: staleWind, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('tile--stale');
  });

  it('adds tile--alarm class for alarm zone', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: 'alarm', sensorGloss: GLOSS });
    expect(html).toContain('tile--alarm');
  });

  it('carries no aria-live attribute', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: normal, sensorGloss: GLOSS });
    expect(html).not.toContain('aria-live');
  });
});
