import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing';
import {
  conditionsFromSignalK,
  defaultProvider,
  defaultProviderName,
  fetchObservationsResult,
  fetchPointForecastsResult,
  fetchWeatherProviders,
  fetchWeatherWarningsResult,
  MAX_OBSERVATION_AGE_MS,
  nearestInTimeBounded,
  normalizePressureTendency,
  pickProviderEntry,
  providerDisplayName,
  providerReadoutContribution,
  type SignalKWeatherData,
} from './signalk-weather';

const ORIGIN = 'https://boat.local';

function mockFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(status, body));
}

describe('weather providers', () => {
  it('keeps the default provider id separate from its display name', async () => {
    const providers = {
      'open-meteo': { name: 'OpenMeteo Marine', isDefault: true },
      backup: { name: 'Backup', isDefault: false },
    };
    const provider = defaultProvider(providers);
    expect(provider).toEqual({ id: 'open-meteo', name: 'OpenMeteo Marine' });
    expect(defaultProviderName(providers)).toBe('OpenMeteo Marine');
    expect(providerDisplayName('open-meteo')).toBe('Open Meteo');

    const fetchFn = mockFetch(providers);
    expect(await fetchWeatherProviders(ORIGIN, undefined, fetchFn)).toEqual(providers);
  });

  it('prettifies an id when the provider has no display name', () => {
    expect(defaultProvider({ 'signalk-weather-accuweather': { isDefault: true } })).toEqual({
      id: 'signalk-weather-accuweather',
      name: 'Accuweather',
    });
  });

  it('normalizes current Signal K wave, swell, and current field names', () => {
    const current = conditionsFromSignalK({
      date: '2026-06-03T12:00:00Z',
      water: {
        waves: { significantHeight: 2, period: 7, directionTrue: 1 },
        swell: { height: 1.5, period: 10, directionTrue: 2 },
        current: { drift: 0.8, set: 3 },
      },
    });
    expect(current).toMatchObject({
      waveHeightM: 2,
      wavePeriodS: 7,
      waveFromRad: 1,
      swellHeightM: 1.5,
      swellPeriodS: 10,
      swellFromRad: 2,
      currentSpeedMs: 0.8,
      currentDirectionRad: 3,
    });
  });

  it('distinguishes no providers from transport failure', async () => {
    expect(await fetchWeatherProviders(ORIGIN, undefined, mockFetch({}))).toEqual({});
    expect(await fetchWeatherProviders(ORIGIN, undefined, mockFetch({}, 500))).toBeUndefined();
  });
});

describe('point endpoint outcomes', () => {
  it('pins every point request to the provider id', async () => {
    const observation = { date: '2026-06-03T12:00:00Z' };
    const obsFetch = mockFetch(observation);
    const forecastFetch = mockFetch([observation]);
    const warningsFetch = mockFetch([]);

    await fetchObservationsResult(ORIGIN, 'provider-id', 5.5, -7.25, 'tok', obsFetch);
    await fetchPointForecastsResult(ORIGIN, 'provider-id', 1, 2, 12, undefined, forecastFetch);
    await fetchWeatherWarningsResult(ORIGIN, 'provider-id', 1, 2, undefined, warningsFetch);

    expect(obsFetch.mock.calls[0][0]).toBe(
      'https://boat.local/signalk/v2/api/weather/observations?lat=5.5&lon=-7.25&provider=provider-id',
    );
    expect(forecastFetch.mock.calls[0][0]).toBe(
      'https://boat.local/signalk/v2/api/weather/forecasts/point?lat=1&lon=2&provider=provider-id&count=12',
    );
    expect(warningsFetch.mock.calls[0][0]).toBe(
      'https://boat.local/signalk/v2/api/weather/warnings?lat=1&lon=2&provider=provider-id',
    );
  });

  it('distinguishes success, empty, unsupported, and failure', async () => {
    expect(
      await fetchObservationsResult(
        ORIGIN,
        'p',
        0,
        0,
        undefined,
        mockFetch({ date: '2026-01-01T00:00:00Z' }),
      ),
    ).toMatchObject({ status: 'success' });
    expect(await fetchObservationsResult(ORIGIN, 'p', 0, 0, undefined, mockFetch([]))).toEqual({
      status: 'empty',
    });
    expect(await fetchObservationsResult(ORIGIN, 'p', 0, 0, undefined, mockFetch({}, 404))).toEqual(
      { status: 'unsupported' },
    );
    expect(await fetchObservationsResult(ORIGIN, 'p', 0, 0, undefined, mockFetch({}, 500))).toEqual(
      { status: 'failure' },
    );
  });

  it('sorts provider forecasts by valid time and drops invalid dates', async () => {
    const result = await fetchPointForecastsResult(
      ORIGIN,
      'p',
      0,
      0,
      12,
      undefined,
      mockFetch([
        { date: '2026-06-03T18:00:00Z' },
        { date: 'bad' },
        { date: '2026-06-03T12:00:00Z' },
      ]),
    );
    expect(result).toEqual({
      status: 'success',
      value: [{ date: '2026-06-03T12:00:00Z' }, { date: '2026-06-03T18:00:00Z' }],
    });
  });
});

describe('Signal K adapter', () => {
  it('converts precipitationVolume meters to millimeters at the boundary', () => {
    const data = { date: '2026-06-03T12:00:00Z', outside: { precipitationVolume: 0.002 } };
    expect(conditionsFromSignalK(data).precipitationMm).toBe(2);
    expect(providerReadoutContribution(data).precipitationMm).toBe(2);
  });

  it('supports legacy flat and current nested waves, swell, and currents', () => {
    const legacy = conditionsFromSignalK({
      date: '2026-06-03T12:00:00Z',
      water: {
        waveSignificantHeight: 1,
        wavePeriod: 6,
        swellHeight: 2,
        swellPeriod: 10,
        surfaceCurrentSpeed: 0.4,
      },
    });
    const nested = conditionsFromSignalK({
      date: '2026-06-03T12:00:00Z',
      water: {
        waves: { significantHeight: 3, period: 8, direction: 1 },
        swell: { height: 4, period: 12, direction: 2 },
        current: { speed: 0.8, direction: 3 },
      },
    });
    expect(legacy).toMatchObject({
      waveHeightM: 1,
      wavePeriodS: 6,
      swellHeightM: 2,
      swellPeriodS: 10,
      currentSpeedMs: 0.4,
    });
    expect(nested).toMatchObject({
      waveHeightM: 3,
      wavePeriodS: 8,
      waveFromRad: 1,
      swellHeightM: 4,
      swellPeriodS: 12,
      swellFromRad: 2,
      currentSpeedMs: 0.8,
      currentDirectionRad: 3,
    });
  });

  it('maps the high-value atmospheric, solar, and marine fields', () => {
    const conditions = conditionsFromSignalK({
      date: '2026-06-03T12:00:00Z',
      outside: {
        feelsLikeTemperature: 295,
        dewPointTemperature: 288,
        relativeHumidity: 0.8,
        precipitationType: 'Rain',
        uvIndex: 6,
      },
      sun: { sunrise: '2026-06-03T10:00:00Z', sunset: '2026-06-04T00:00:00Z' },
      current: { speed: 0.5, direction: 2.5 },
    });
    expect(conditions).toMatchObject({
      feelsLikeK: 295,
      dewPointK: 288,
      humidityFraction: 0.8,
      precipitationType: 'Rain',
      uvIndex: 6,
      currentSpeedMs: 0.5,
      currentDirectionRad: 2.5,
      sunriseMs: Date.parse('2026-06-03T10:00:00Z'),
      sunsetMs: Date.parse('2026-06-04T00:00:00Z'),
    });
  });

  it('normalizes pressure tendency and rejects not-available values for fallback', () => {
    expect(normalizePressureTendency(' Increasing ')).toBe('rising');
    expect(normalizePressureTendency(-2)).toBe('falling');
    expect(normalizePressureTendency('not available')).toBeUndefined();
    expect(normalizePressureTendency('N/A')).toBeUndefined();
  });
});

describe('provider time selection', () => {
  const now = Date.parse('2026-06-03T12:00:00Z');

  it('bounds observation age and falls back to a forecast when the observation is too old', () => {
    const old = { date: new Date(now - MAX_OBSERVATION_AGE_MS - 1).toISOString() };
    const forecast = [{ date: new Date(now).toISOString(), wind: { speedTrue: 5 } }];
    expect(pickProviderEntry(old, forecast, now, now)).toEqual({
      entry: forecast[0],
      observed: false,
    });
  });

  it('uses a recent observation near now', () => {
    const observation = { date: new Date(now - 30 * 60_000).toISOString() };
    expect(pickProviderEntry(observation, undefined, now, now)).toEqual({
      entry: observation,
      observed: true,
    });
  });

  it('does not use a forecast step beyond its cadence bound', () => {
    const series: SignalKWeatherData[] = [
      { date: '2026-06-03T12:00:00Z' },
      { date: '2026-06-03T15:00:00Z' },
    ];
    expect(nearestInTimeBounded(series, Date.parse('2026-06-05T00:00:00Z'))).toBeUndefined();
  });
});
