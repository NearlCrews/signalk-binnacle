import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateRoute,
  activationFromCourse,
  advancePoint,
  clearCourse,
  hydrateCourse,
  refreshActiveRoute,
  setDestination,
} from './course-client';

afterEach(() => vi.restoreAllMocks());
const ok = { ok: true, json: async () => ({}) } as Response;
const COURSE = '/signalk/v2/api/vessels/self/navigation/course';

it('activateRoute PUTs the href, pointIndex, and reverse', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok);
  expect(await activateRoute('http://pi', 'tok', '/resources/routes/abc', 0, false)).toBe(true);
  expect(f.mock.calls[0][0]).toBe(`http://pi${COURSE}/activeRoute`);
  const init = f.mock.calls[0][1] as RequestInit;
  expect(init.method).toBe('PUT');
  expect(JSON.parse(init.body as string)).toEqual({
    href: '/resources/routes/abc',
    pointIndex: 0,
    reverse: false,
  });
});

it('setDestination PUTs the position to the destination endpoint', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok);
  expect(await setDestination('http://pi', 'tok', { latitude: 42.5, longitude: -83.1 })).toBe(true);
  expect(f.mock.calls[0][0]).toBe(`http://pi${COURSE}/destination`);
  const init = f.mock.calls[0][1] as RequestInit;
  expect(init.method).toBe('PUT');
  expect(JSON.parse(init.body as string)).toEqual({
    position: { latitude: 42.5, longitude: -83.1 },
  });
});

it('advancePoint PUTs a signed increment', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok);
  await advancePoint('http://pi', 'tok', 1);
  expect(f.mock.calls[0][0]).toBe(`http://pi${COURSE}/activeRoute/nextPoint`);
  expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({ value: 1 });
});

it('advancePoint rejects zero and non-integer increments without a request', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok);
  expect(await advancePoint('http://pi', 'tok', 0)).toBe(false);
  expect(await advancePoint('http://pi', 'tok', 1.5)).toBe(false);
  expect(f).not.toHaveBeenCalled();
});

it('refreshActiveRoute PUTs to the Course API refresh endpoint', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok);
  expect(await refreshActiveRoute('http://pi', 'tok')).toBe(true);
  expect(f.mock.calls[0][0]).toBe(`http://pi${COURSE}/activeRoute/refresh`);
  expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({});
});

it('clearCourse DELETEs the course', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok);
  await clearCourse('http://pi', 'tok');
  expect(f.mock.calls[0][0]).toBe(`http://pi${COURSE}`);
  expect((f.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
});

describe('activationFromCourse', () => {
  it('reads the route id out of an activeRoute href, decoding it', () => {
    expect(activationFromCourse({ activeRoute: { href: '/resources/routes/abc%20def' } })).toEqual({
      routeId: 'abc def',
    });
  });

  it('ignores unrelated and malformed route hrefs without throwing', () => {
    expect(activationFromCourse({ activeRoute: { href: '/resources/waypoints/abc' } })).toEqual({});
    expect(activationFromCourse({ activeRoute: { href: '/resources/routes/%GG' } })).toEqual({});
  });

  it('reports a goto for a bare destination with no route', () => {
    expect(
      activationFromCourse({ nextPoint: { position: { latitude: 1, longitude: 2 } } }),
    ).toEqual({ goto: true });
  });

  it('reports an empty activation when the snapshot has no course', () => {
    expect(activationFromCourse({})).toEqual({});
  });

  it('reports nothing known for an absent snapshot', () => {
    expect(activationFromCourse(undefined)).toBeUndefined();
  });
});

describe('hydrateCourse', () => {
  it('reads the course snapshot and calcValues together on connect', async () => {
    const info = { nextPoint: { position: { latitude: 1, longitude: 2 } } };
    const calc = { crossTrackError: 5 };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = String(url).endsWith('/calcValues') ? calc : info;
      return { ok: true, json: async () => body } as Response;
    });
    const result = await hydrateCourse('http://pi', 'tok');
    expect(result.info?.nextPoint?.position).toEqual({ latitude: 1, longitude: 2 });
    expect(result.calc?.crossTrackError).toBe(5);
  });

  it('degrades the calcValues half when its fetch is not ok, keeping the course', async () => {
    const info = { nextPoint: { position: { latitude: 0, longitude: 0 } } };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/calcValues')) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => info } as Response;
    });
    const result = await hydrateCourse('http://pi', undefined);
    expect(result.info?.nextPoint).toBeDefined();
    expect(result.calc).toBeUndefined();
  });
});
