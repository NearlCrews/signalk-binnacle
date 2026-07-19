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
  MAX_WEATHER_FORECASTS,
  MAX_WEATHER_OBSERVATIONS,
  MAX_WEATHER_PROVIDERS,
  MAX_WEATHER_WARNINGS,
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

  it('rejects oversized or unsafe provider catalogs', async () => {
    const oversized = Object.fromEntries(
      Array.from({ length: MAX_WEATHER_PROVIDERS + 1 }, (_, index) => [
        `provider-${index}`,
        { isDefault: index === 0 },
      ]),
    );
    expect(await fetchWeatherProviders(ORIGIN, undefined, mockFetch(oversized))).toBeUndefined();
    expect(
      await fetchWeatherProviders(
        ORIGIN,
        undefined,
        mockFetch({ 'bad\u0000provider': { isDefault: true } }),
      ),
    ).toBeUndefined();
    expect(
      await fetchWeatherProviders(
        ORIGIN,
        undefined,
        mockFetch(JSON.parse('{"__proto__":{"isDefault":true}}')),
      ),
    ).toBeUndefined();
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
    expect((obsFetch.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
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

  it('caps sorted forecasts to the requested count', async () => {
    const result = await fetchPointForecastsResult(
      ORIGIN,
      'p',
      0,
      0,
      2,
      undefined,
      mockFetch([
        { date: '2026-06-03T18:00:00Z' },
        { date: '2026-06-03T12:00:00Z' },
        { date: '2026-06-03T15:00:00Z' },
      ]),
    );
    expect(result).toEqual({
      status: 'success',
      value: [{ date: '2026-06-03T12:00:00Z' }, { date: '2026-06-03T15:00:00Z' }],
    });
  });

  it('rejects oversized observation, forecast, and warning collections', async () => {
    const observation = { date: '2026-06-03T12:00:00Z' };
    await expect(
      fetchObservationsResult(
        ORIGIN,
        'p',
        0,
        0,
        undefined,
        mockFetch(Array.from({ length: MAX_WEATHER_OBSERVATIONS + 1 }, () => observation)),
      ),
    ).resolves.toEqual({ status: 'failure' });
    await expect(
      fetchPointForecastsResult(
        ORIGIN,
        'p',
        0,
        0,
        MAX_WEATHER_FORECASTS,
        undefined,
        mockFetch(Array.from({ length: MAX_WEATHER_FORECASTS + 1 }, () => observation)),
      ),
    ).resolves.toEqual({ status: 'failure' });
    const warning = {
      startTime: '2026-06-03T12:00:00Z',
      endTime: '2026-06-03T18:00:00Z',
      details: 'Gale warning',
      source: 'Provider',
      type: 'gale',
    };
    await expect(
      fetchWeatherWarningsResult(
        ORIGIN,
        'p',
        0,
        0,
        undefined,
        mockFetch(Array.from({ length: MAX_WEATHER_WARNINGS + 1 }, () => warning)),
      ),
    ).resolves.toEqual({ status: 'failure' });
  });

  it('keeps warnings with missing or oversized optional text by applying bounded fallbacks', async () => {
    const result = await fetchWeatherWarningsResult(
      ORIGIN,
      'p',
      0,
      0,
      undefined,
      mockFetch([
        {
          startTime: '2026-06-03T12:00:00Z',
          endTime: '2026-06-03T18:00:00Z',
          details: 'x'.repeat(5_000),
          source: undefined,
          type: 'x'.repeat(300),
        },
      ]),
    );
    expect(result).toEqual({
      status: 'success',
      value: [
        {
          startTime: '2026-06-03T12:00:00Z',
          endTime: '2026-06-03T18:00:00Z',
          details: 'Details unavailable.',
          source: 'Weather provider',
          type: 'Weather warning',
        },
      ],
    });
  });

  it('rejects an inverted warning interval', async () => {
    await expect(
      fetchWeatherWarningsResult(
        ORIGIN,
        'p',
        0,
        0,
        undefined,
        mockFetch([
          {
            startTime: '2026-06-03T18:00:00Z',
            endTime: '2026-06-03T12:00:00Z',
            details: 'Gale warning',
            source: 'Provider',
            type: 'gale',
          },
        ]),
      ),
    ).resolves.toEqual({ status: 'failure' });
  });

  it('rejects malformed atmospheric and marine leaves before normalization', async () => {
    const malformed = [
      { outside: { pressureTendency: {} } },
      { outside: { pressure: '101325' } },
      { wind: { speedTrue: '5' } },
      { water: { temperature: '290' } },
      { water: { waves: { significantHeight: '2' } } },
      { water: { swell: [] } },
      { water: { current: { speed: {} } } },
      { current: { direction: '1.5' } },
    ];

    for (const fields of malformed) {
      await expect(
        fetchObservationsResult(
          ORIGIN,
          'p',
          0,
          0,
          undefined,
          mockFetch({ date: '2026-06-03T12:00:00Z', ...fields }),
        ),
      ).resolves.toEqual({ status: 'failure' });
    }
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
    expect(normalizePressureTendency({} as never)).toBeUndefined();
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
