import { describe, expect, it, vi } from 'vitest';
import {
  fetchForecast,
  fetchMarine,
  MAX_FORECAST_HOURLY_STEPS,
  type MarineFields,
  mergeMarine,
} from './weather-client';

function res(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

// Open-Meteo returns one object per location for a multi-location request. timeformat=unixtime
// makes hourly.time numeric seconds.
function loc(
  lat: number,
  lon: number,
  speed: Array<number | null>,
  dir: Array<number | null>,
): unknown {
  return {
    latitude: lat,
    longitude: lon,
    hourly: {
      time: [1748908800, 1748912400],
      wind_speed_10m: speed,
      wind_direction_10m: dir,
      pressure_msl: [1013, 1012],
      precipitation: [0, 0.2],
      cloud_cover: [10, 50],
    },
  };
}

describe('fetchForecast', () => {
  it('parses a 2x2 grid and derives u/v from speed and direction', async () => {
    const body = [
      loc(0, 0, [10, 10], [90, 90]),
      loc(0, 1, [0, 0], [0, 0]),
      loc(1, 0, [0, 0], [0, 0]),
      loc(1, 1, [0, 0], [0, 0]),
    ];
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => res(body));
    const grid = await fetchForecast(
      { west: 0, south: 0, east: 1, north: 1 },
      { maxCells: 4, forecastDays: 1 },
      fetchFn as unknown as typeof fetch,
    );
    expect(grid?.lats.length).toBe(2);
    expect(grid?.times.length).toBe(2);
    // 10 m/s from 90 degrees (east) blows toward the west: u about -10, v about 0.
    expect(grid?.windU[0][0]).toBeCloseTo(-10, 4);
    expect(grid?.windV[0][0]).toBeCloseTo(0, 4);
    expect(grid?.times[0]).toBe(1748908800000);
    expect(grid?.atmosphericSource?.coordinates[0]).toEqual({ latitude: 0, longitude: 0 });
    expect(grid?.atmosphericSource?.times).toEqual(grid?.times);
    // pressure_msl is hPa on the wire; the grid stores Pa.
    expect(grid?.pressureMsl?.[0]?.[0]).toBe(101300);
    expect(grid?.pressureMsl?.[1]?.[0]).toBe(101200);
    expect(grid?.precipitation?.[0]?.[0]).toBe(0);
    expect(grid?.precipitation?.[1]?.[0]).toBeCloseTo(0.2, 4);
    expect(grid?.precipitationInterval).toBe('preceding-hour');
    expect(grid?.precipitationInterpolation).toBe('step');
    // cloud_cover is percent on the wire; the grid stores a 0..1 fraction.
    expect(grid?.cloudCover?.[0]?.[0]).toBeCloseTo(0.1, 4);
    expect(grid?.cloudCover?.[1]?.[0]).toBeCloseTo(0.5, 4);
  });

  it('does not fabricate calm wind when speed or direction is missing', async () => {
    const body = [
      loc(0, 0, [null, 10], [90, null]),
      loc(0, 1, [0, 0], [0, 0]),
      loc(1, 0, [0, 0], [0, 0]),
      loc(1, 1, [0, 0], [0, 0]),
    ];
    const grid = await fetchForecast(
      { west: 0, south: 0, east: 1, north: 1 },
      { maxCells: 4, forecastDays: 1 },
      vi.fn(async () => res(body)) as unknown as typeof fetch,
    );
    expect(grid?.windU[0][0]).toBeNaN();
    expect(grid?.windV[1][0]).toBeNaN();
  });

  it('propagates caller aborts instead of reporting an endpoint failure', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn((_input, init) => {
      controller.abort();
      return Promise.reject(init?.signal?.reason);
    }) as unknown as typeof fetch;
    await expect(
      fetchForecast(
        { west: 0, south: 0, east: 1, north: 1 },
        { maxCells: 4, forecastDays: 1 },
        fetchFn,
        controller.signal,
      ),
    ).rejects.toBeDefined();
  });

  it('retains timeout composition when AbortSignal.any is unavailable', async () => {
    const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    if (!anyDescriptor) throw new Error('AbortSignal.any descriptor is unavailable');
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal;
      return res([
        loc(0, 0, [0, 0], [0, 0]),
        loc(0, 1, [0, 0], [0, 0]),
        loc(1, 0, [0, 0], [0, 0]),
        loc(1, 1, [0, 0], [0, 0]),
      ]);
    });

    try {
      await fetchForecast(
        { west: 0, south: 0, east: 1, north: 1 },
        { maxCells: 4, forecastDays: 1 },
        fetchFn as unknown as typeof fetch,
        controller.signal,
      );
      expect(requestSignal).toBeInstanceOf(AbortSignal);
      expect(requestSignal).not.toBe(controller.signal);
      controller.abort(new Error('superseded'));
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      Object.defineProperty(AbortSignal, 'any', anyDescriptor);
    }
  });

  it('wraps antimeridian grid requests while preserving unwrapped coverage', async () => {
    const body = [
      loc(0, 170, [0, 0], [0, 0]),
      loc(0, -170, [0, 0], [0, 0]),
      loc(1, 170, [0, 0], [0, 0]),
      loc(1, -170, [0, 0], [0, 0]),
    ];
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => res(body));
    const grid = await fetchForecast(
      { west: 170, south: 0, east: 190, north: 1 },
      { maxCells: 4, forecastDays: 1 },
      fetchFn as unknown as typeof fetch,
    );
    const requestUrl = new URL(String(fetchFn.mock.calls[0][0]));
    expect(requestUrl.searchParams.get('longitude')).toBe('170.0000,-170.0000,170.0000,-170.0000');
    expect(grid?.lons).toEqual([170, 190]);
  });

  it('returns undefined on a fetch failure', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    const grid = await fetchForecast(
      { west: 0, south: 0, east: 1, north: 1 },
      { maxCells: 4, forecastDays: 1 },
      fetchFn as unknown as typeof fetch,
    );
    expect(grid).toBeUndefined();
  });

  it('rejects oversized, non-finite, or non-monotonic hourly axes before allocation', async () => {
    const invalidTimes: unknown[][] = [
      Array.from({ length: MAX_FORECAST_HOURLY_STEPS + 1 }, (_, index) => 1_700_000_000 + index),
      [1_700_000_000, Number.NaN],
      [1_700_000_000, 1_700_000_000],
    ];
    for (const time of invalidTimes) {
      const body = Array.from({ length: 4 }, () => {
        const value = loc(0, 0, [], []) as { hourly: { time: unknown[] } };
        value.hourly.time = time;
        return value;
      });
      await expect(
        fetchForecast(
          { west: 0, south: 0, east: 1, north: 1 },
          { maxCells: 4, forecastDays: 1 },
          vi.fn(async () => res(body)) as unknown as typeof fetch,
        ),
      ).resolves.toBeUndefined();
    }
  });
});

function marineLoc(height: number[], dir: number[], period: number[], lat = 0, lon = 0): unknown {
  return {
    latitude: lat,
    longitude: lon,
    hourly: {
      time: [1748908800, 1748912400],
      wave_height: height,
      wave_direction: dir,
      wave_period: period,
      wind_wave_height: [0.5, 0.6],
      wind_wave_direction: [100, 110],
      wind_wave_period: [4, 5],
      wind_wave_peak_period: [5, 6],
      swell_wave_height: [1, 1.2],
      swell_wave_direction: [80, 85],
      swell_wave_period: [8, 9],
      swell_wave_peak_period: [10, 11],
      ocean_current_velocity: [0.4, 0.5],
      ocean_current_direction: [180, 190],
      sea_surface_temperature: [290, 291],
    },
  };
}

describe('fetchMarine', () => {
  it('parses wave height, direction (to radians), and period for the grid', async () => {
    const body = [
      marineLoc([1.5, 2], [90, 90], [7, 8], 0, 0),
      marineLoc([0, 0], [0, 0], [0, 0], 0, 1),
      marineLoc([0, 0], [0, 0], [0, 0], 1, 0),
      marineLoc([0, 0], [0, 0], [0, 0], 1, 1),
    ];
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => res(body));
    const marine = await fetchMarine(
      { west: 0, south: 0, east: 1, north: 1 },
      { maxCells: 4, forecastDays: 1 },
      fetchFn as unknown as typeof fetch,
    );
    expect(marine?.waveHeight[0][0]).toBeCloseTo(1.5, 4);
    expect(marine?.waveDirection[0][0]).toBeCloseTo(Math.PI / 2, 4);
    expect(marine?.wavePeriod[0][0]).toBeCloseTo(7, 4);
    expect(marine?.windWavePeakPeriod[0][0]).toBe(5);
    expect(marine?.swellWaveHeight[0][0]).toBe(1);
    expect(marine?.oceanCurrentSpeed[0][0]).toBe(0.4);
    expect(marine?.oceanCurrentDirection[0][0]).toBeCloseTo(Math.PI, 4);
    expect(marine?.seaSurfaceTemperature[0][0]).toBe(290);
    expect(marine?.source.coordinates[3]).toEqual({ latitude: 1, longitude: 1 });
    expect(marine?.source.times[0]).toBe(1748908800000);
    const requestUrl = new URL(String(fetchFn.mock.calls[0][0]));
    expect(requestUrl.searchParams.get('velocity_unit')).toBe('ms');
    expect(requestUrl.searchParams.get('temperature_unit')).toBe('kelvin');
  });

  it('returns undefined on failure', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(
      await fetchMarine(
        { west: 0, south: 0, east: 1, north: 1 },
        { maxCells: 4, forecastDays: 1 },
        fetchFn as unknown as typeof fetch,
      ),
    ).toBeUndefined();
  });

  it('rejects an oversized marine hourly axis before allocating field grids', async () => {
    const time = Array.from(
      { length: MAX_FORECAST_HOURLY_STEPS + 1 },
      (_, index) => 1_700_000_000 + index,
    );
    const body = Array.from({ length: 4 }, () => {
      const value = marineLoc([], [], []) as { hourly: { time: number[] } };
      value.hourly.time = time;
      return value;
    });
    await expect(
      fetchMarine(
        { west: 0, south: 0, east: 1, north: 1 },
        { maxCells: 4, forecastDays: 1 },
        vi.fn(async () => res(body)) as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('mergeMarine', () => {
  it('attaches the marine fields to the grid', () => {
    const grid = {
      lats: [0, 1],
      lons: [0, 1],
      times: [1000, 4000],
      windU: [new Array(4).fill(0), new Array(4).fill(0)],
      windV: [new Array(4).fill(0), new Array(4).fill(0)],
      atmosphericSource: {
        coordinates: [
          { latitude: 0, longitude: 0 },
          { latitude: 0, longitude: 1 },
          { latitude: 1, longitude: 0 },
          { latitude: 1, longitude: 1 },
        ],
        times: [1000, 4000],
      },
    };
    const marine = {
      source: {
        coordinates: grid.atmosphericSource.coordinates,
        times: [1000, 4000],
      },
      waveHeight: [new Array(4).fill(2), new Array(4).fill(2)],
      waveDirection: [new Array(4).fill(0), new Array(4).fill(0)],
      wavePeriod: [new Array(4).fill(6), new Array(4).fill(6)],
    } as MarineFields;
    const merged = mergeMarine(grid, marine);
    expect(merged.waveHeight?.[0][0]).toBe(2);
    expect(merged.windU).toBe(grid.windU);
    expect(merged.marineAlignment).toEqual({ maxDisplacementM: 0, maxTimeMismatchMs: 0 });
  });

  it('does not attach marine values when returned times do not align', () => {
    const grid = {
      lats: [0, 1],
      lons: [0, 1],
      times: [1000],
      windU: [[0, 0, 0, 0]],
      windV: [[0, 0, 0, 0]],
      atmosphericSource: {
        coordinates: new Array(4).fill({ latitude: 0, longitude: 0 }),
        times: [1000],
      },
    };
    const marine = {
      source: {
        coordinates: new Array(4).fill({ latitude: 0, longitude: 0 }),
        times: [2000],
      },
      waveHeight: [[2, 2, 2, 2]],
    } as MarineFields;
    const merged = mergeMarine(grid, marine);
    expect(merged.waveHeight).toBeUndefined();
    expect(merged.marineAlignment?.maxTimeMismatchMs).toBe(1000);
  });

  it('does not attach marine values when source cells are displaced unsafely', () => {
    const grid = {
      lats: [0, 1],
      lons: [0, 1],
      times: [1000],
      windU: [[0, 0, 0, 0]],
      windV: [[0, 0, 0, 0]],
      atmosphericSource: {
        coordinates: new Array(4).fill({ latitude: 0, longitude: 0 }),
        times: [1000],
      },
    };
    const marine = {
      source: {
        coordinates: new Array(4).fill({ latitude: 0, longitude: 2 }),
        times: [1000],
      },
      waveHeight: [[2, 2, 2, 2]],
    } as MarineFields;
    const merged = mergeMarine(grid, marine);
    expect(merged.waveHeight).toBeUndefined();
    expect(merged.marineAlignment?.maxDisplacementM).toBeGreaterThan(200_000);
  });
});
