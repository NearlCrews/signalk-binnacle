import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import { MAX_RADAR_TARGETS } from './radar-limits';
import { fetchRadarTargets, toCollisionContacts, toRadarTarget } from './radar-targets';
import type { RadarTarget } from './radar-types';

afterEach(() => vi.unstubAllGlobals());

// A complete wire target as signalk-server 2.27.0 and the Mayara tracker serve it: camelCase
// envelope fields, position in degrees, motion in radians and m/s, danger in meters and seconds.
const wireTarget = {
  id: 7,
  status: 'tracking',
  position: { bearing: 1.2, distance: 1400, latitude: 59.1, longitude: 10.5 },
  motion: { course: 0.5, speed: 3.2 },
  danger: { cpa: 200, tcpa: 120, is_dangerous: true },
  acquisition: 'auto',
  firstSeen: '2026-08-30T10:00:00Z',
  lastSeen: '2026-08-30T10:01:00Z',
};

describe('toRadarTarget', () => {
  it('parses a complete tracked target', () => {
    expect(toRadarTarget(wireTarget)).toEqual({
      id: 7,
      status: 'tracking',
      position: { latitude: 59.1, longitude: 10.5 },
      courseRad: 0.5,
      speedMps: 3.2,
      cpaMeters: 200,
      tcpaSeconds: 120,
    });
  });

  it('keeps an acquiring target without motion or danger, for the unassessed path', () => {
    const parsed = toRadarTarget({
      id: 3,
      status: 'acquiring',
      position: { bearing: 0.1, distance: 900, latitude: 1, longitude: 2 },
    });
    expect(parsed).toEqual({ id: 3, status: 'acquiring', position: { latitude: 1, longitude: 2 } });
  });

  it('drops a lost target and unknown statuses', () => {
    expect(toRadarTarget({ ...wireTarget, status: 'lost' })).toBeUndefined();
    expect(toRadarTarget({ ...wireTarget, status: 'weird' })).toBeUndefined();
    expect(toRadarTarget({ ...wireTarget, status: 4 })).toBeUndefined();
  });

  it('drops a target without a georeferenced position', () => {
    expect(
      toRadarTarget({ ...wireTarget, position: { bearing: 1.2, distance: 1400 } }),
    ).toBeUndefined();
    expect(
      toRadarTarget({ ...wireTarget, position: { latitude: 91, longitude: 10 } }),
    ).toBeUndefined();
    expect(
      toRadarTarget({ ...wireTarget, position: { latitude: 10, longitude: 181 } }),
    ).toBeUndefined();
    expect(toRadarTarget({ ...wireTarget, position: undefined })).toBeUndefined();
  });

  it('drops invalid ids', () => {
    expect(toRadarTarget({ ...wireTarget, id: -1 })).toBeUndefined();
    expect(toRadarTarget({ ...wireTarget, id: 1.5 })).toBeUndefined();
    expect(toRadarTarget({ ...wireTarget, id: '7' })).toBeUndefined();
  });

  it('drops the motion pair together when either half is out of bounds', () => {
    const noSpeed = toRadarTarget({ ...wireTarget, motion: { course: 0.5, speed: -1 } });
    expect(noSpeed?.speedMps).toBeUndefined();
    expect(noSpeed?.courseRad).toBeUndefined();
    const fastAircraft = toRadarTarget({ ...wireTarget, motion: { course: 0.5, speed: 500 } });
    expect(fastAircraft?.speedMps).toBeUndefined();
    const wildCourse = toRadarTarget({ ...wireTarget, motion: { course: 9, speed: 3 } });
    expect(wildCourse?.courseRad).toBeUndefined();
    // The danger pair survives a dropped motion pair.
    expect(noSpeed?.cpaMeters).toBe(200);
  });

  it('drops the danger pair together when either half is out of bounds, keeping the target', () => {
    const negativeCpa = toRadarTarget({ ...wireTarget, danger: { cpa: -5, tcpa: 60 } });
    expect(negativeCpa?.cpaMeters).toBeUndefined();
    expect(negativeCpa?.tcpaSeconds).toBeUndefined();
    expect(negativeCpa?.speedMps).toBe(3.2);
    const absurdTcpa = toRadarTarget({ ...wireTarget, danger: { cpa: 200, tcpa: 1e9 } });
    expect(absurdTcpa?.cpaMeters).toBeUndefined();
  });

  it('keeps a negative tcpa: the approach has passed and drives the receding hold', () => {
    const passed = toRadarTarget({ ...wireTarget, danger: { cpa: 150, tcpa: -30 } });
    expect(passed?.cpaMeters).toBe(150);
    expect(passed?.tcpaSeconds).toBe(-30);
  });
});

describe('fetchRadarTargets', () => {
  it('fetches the targets route with bearer auth and parses the array', async () => {
    const mock = stubFetch({ ok: true, body: [wireTarget, { bogus: true }] });
    const outcome = await fetchRadarTargets('http://boat.local', 'tok', 'nav 1');
    expect(mock.mock.calls[0]?.[0]).toBe(
      'http://boat.local/signalk/v2/api/vessels/self/radars/nav%201/targets',
    );
    expectBearerAuth(mock.mock.calls[0]?.[1], 'tok');
    expect(outcome).toEqual({
      kind: 'ok',
      targets: [expect.objectContaining({ id: 7, cpaMeters: 200 })],
    });
  });

  it('reports unsupported for the statuses that mean the endpoint will never answer', async () => {
    for (const status of [400, 404, 405, 501]) {
      stubFetch({ ok: false, status });
      expect(await fetchRadarTargets('', undefined, 'a')).toEqual({ kind: 'unsupported' });
    }
  });

  it('reports an error for transient failures, never a silent empty list', async () => {
    stubFetch({ ok: false, status: 500 });
    expect(await fetchRadarTargets('', undefined, 'a')).toEqual({ kind: 'error' });
    stubFetch({ ok: false, status: 401 });
    expect(await fetchRadarTargets('', undefined, 'a')).toEqual({ kind: 'error' });
    stubFetch('reject');
    expect(await fetchRadarTargets('', undefined, 'a')).toEqual({ kind: 'error' });
    stubFetch({ ok: true, body: { not: 'an array' } });
    expect(await fetchRadarTargets('', undefined, 'a')).toEqual({ kind: 'error' });
    stubFetch({ ok: true, body: Array.from({ length: MAX_RADAR_TARGETS + 1 }, () => wireTarget) });
    expect(await fetchRadarTargets('', undefined, 'a')).toEqual({ kind: 'error' });
  });
});

describe('toCollisionContacts', () => {
  it('namespaces ids under the radar and names contacts for the danger strip', () => {
    const targets: RadarTarget[] = [
      {
        id: 7,
        status: 'tracking',
        position: { latitude: 59.1, longitude: 10.5 },
        courseRad: 0.5,
        speedMps: 3.2,
        cpaMeters: 200,
        tcpaSeconds: 120,
      },
      { id: 3, status: 'acquiring', position: { latitude: 1, longitude: 2 } },
    ];
    expect(toCollisionContacts('nav1', targets)).toEqual([
      {
        id: 'radar:nav1:7',
        name: 'Radar 7',
        position: { latitude: 59.1, longitude: 10.5 },
        sogMps: 3.2,
        cogRad: 0.5,
        cpaMeters: 200,
        tcpaSeconds: 120,
      },
      {
        id: 'radar:nav1:3',
        name: 'Radar 3',
        position: { latitude: 1, longitude: 2 },
        sogMps: undefined,
        cogRad: undefined,
        cpaMeters: undefined,
        tcpaSeconds: undefined,
      },
    ]);
  });
});
