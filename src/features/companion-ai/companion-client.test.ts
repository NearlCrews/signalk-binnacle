import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import { fetchCompanionReports, MAX_COMPANION_ANALYZERS, runAnalyzer } from './companion-client';

const REPORT_TIME = '2026-08-28T10:00:00.000Z';

function reportNode(message: string, state = 'nominal', timestamp: string = REPORT_TIME) {
  return { report: { value: { state, method: [], message }, timestamp, $source: 'companion' } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCompanionReports', () => {
  it('hydrates the notifications branch with bearer auth', async () => {
    const mock = stubFetch({
      ok: true,
      body: {
        maintenance: reportNode('Oil service due in 20 hours.\nBased on 140 engine hours.'),
        forecast: reportNode('forecast report unavailable: budget exhausted', 'warn'),
        junk: { report: { value: { state: 'nominal' } } },
      },
    });
    const result = await fetchCompanionReports('http://sk', 'tok');
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.reports).toEqual([
      {
        analyzerId: 'maintenance',
        message: 'Oil service due in 20 hours.\nBased on 140 engine hours.',
        state: 'nominal',
        timestampMs: Date.parse(REPORT_TIME),
      },
      {
        analyzerId: 'forecast',
        message: 'forecast report unavailable: budget exhausted',
        state: 'warn',
        timestampMs: Date.parse(REPORT_TIME),
      },
    ]);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://sk/signalk/v1/api/vessels/self/notifications/openrouter-companion');
    expectBearerAuth(init, 'tok');
  });

  it('rejects unsafe analyzer keys and control-character messages', async () => {
    const body: Record<string, unknown> = {
      constructor: reportNode('polluted'),
      health: reportNode(`bad${String.fromCharCode(7)}text`),
      drift: reportNode('kept'),
    };
    // A literal __proto__ key in an object literal would set the prototype, not an own entry.
    Object.defineProperty(body, '__proto__', { value: reportNode('polluted'), enumerable: true });
    stubFetch({ ok: true, body });
    const result = await fetchCompanionReports('http://sk', undefined);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.reports.map((report) => report.analyzerId)).toEqual(['drift']);
  });

  it('bounds the analyzer count', async () => {
    const body: Record<string, unknown> = {};
    for (let index = 0; index < MAX_COMPANION_ANALYZERS + 8; index += 1) {
      body[`analyzer${index}`] = reportNode(`report ${index}`);
    }
    stubFetch({ ok: true, body });
    const result = await fetchCompanionReports('http://sk', undefined);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.reports).toHaveLength(MAX_COMPANION_ANALYZERS);
  });

  it('tells a real absent branch from a transport failure', async () => {
    stubFetch({ ok: false, status: 404 });
    expect(await fetchCompanionReports('http://sk', undefined)).toEqual({ state: 'absent' });
    stubFetch({ ok: false, status: 500 });
    expect(await fetchCompanionReports('http://sk', undefined)).toEqual({ state: 'unavailable' });
    stubFetch('reject');
    expect(await fetchCompanionReports('http://sk', undefined)).toEqual({ state: 'unavailable' });
  });

  it('treats a non-object body as a reachable empty', async () => {
    stubFetch({ ok: true, body: [] });
    expect(await fetchCompanionReports('http://sk', undefined)).toEqual({
      state: 'ok',
      reports: [],
    });
  });
});

describe('runAnalyzer', () => {
  it('PUTs the run path and maps a pending ack to started', async () => {
    const mock = stubFetch({ ok: true, status: 202, body: { state: 'PENDING' } });
    const ack = await runAnalyzer('http://sk', 'tok', 'maintenance');
    expect(ack).toEqual({ kind: 'started', message: undefined });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://sk/signalk/v1/api/vessels/self/plugins/openrouter-companion/maintenance/run',
    );
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ value: {} });
    expectBearerAuth(init, 'tok');
  });

  it('carries the server ack message through completed and refused outcomes', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: { state: 'COMPLETED', message: 'nothing to report' },
    });
    expect(await runAnalyzer('http://sk', 'tok', 'health')).toEqual({
      kind: 'completed',
      message: 'nothing to report',
    });
    stubFetch({
      ok: false,
      status: 429,
      body: { state: 'COMPLETED', statusCode: 429, message: 'daily call budget exhausted' },
    });
    expect(await runAnalyzer('http://sk', 'tok', 'health')).toEqual({
      kind: 'refused',
      message: 'daily call budget exhausted',
    });
  });

  it('maps auth refusals, missing handlers, and transport failures distinctly', async () => {
    stubFetch({ ok: false, status: 403 });
    expect((await runAnalyzer('http://sk', 'tok', 'drift')).kind).toBe('access-denied');
    stubFetch({ ok: false, status: 405 });
    expect((await runAnalyzer('http://sk', 'tok', 'drift')).kind).toBe('unavailable');
    stubFetch('reject');
    expect((await runAnalyzer('http://sk', 'tok', 'drift')).kind).toBe('unreachable');
  });

  it('refuses an unsafe analyzer id without a request', async () => {
    const mock = stubFetch({ ok: true, body: {} });
    expect((await runAnalyzer('http://sk', 'tok', '__proto__')).kind).toBe('refused');
    expect(mock).not.toHaveBeenCalled();
  });
});
