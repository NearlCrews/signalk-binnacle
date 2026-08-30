import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import { createLogEntry, detectLogbook, fetchRecentEntries } from './logbook-client';

const ORIGIN = 'http://boat.local:3000';
const LOGS_URL = `${ORIGIN}/plugins/signalk-logbook/logs`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectLogbook', () => {
  it('probes the plugin mount with bearer auth and reports available', async () => {
    const mock = stubFetch({ ok: true, body: ['2026-08-30'] });
    await expect(detectLogbook(ORIGIN, 'tok')).resolves.toBe('available');
    expect(mock).toHaveBeenCalledWith(LOGS_URL, expect.anything());
    expectBearerAuth(mock.mock.calls[0]?.[1], 'tok');
  });

  it('maps a 404 on the mount to absent', async () => {
    stubFetch({ ok: false, status: 404 });
    await expect(detectLogbook(ORIGIN, undefined)).resolves.toBe('absent');
  });

  it('maps 401 and 403 to unauthorized', async () => {
    stubFetch({ ok: false, status: 401 });
    await expect(detectLogbook(ORIGIN, undefined)).resolves.toBe('unauthorized');
    stubFetch({ ok: false, status: 403 });
    await expect(detectLogbook(ORIGIN, undefined)).resolves.toBe('unauthorized');
  });

  it('maps a server failure and a network failure to error', async () => {
    stubFetch({ ok: false, status: 500 });
    await expect(detectLogbook(ORIGIN, undefined)).resolves.toBe('error');
    stubFetch('reject');
    await expect(detectLogbook(ORIGIN, undefined)).resolves.toBe('error');
  });
});

describe('fetchRecentEntries', () => {
  it('reads only the newest logged days and merges their entries newest first', async () => {
    const mock = stubFetch((url) => {
      if (url === LOGS_URL) {
        // The plugin lists readdir order, which is not guaranteed sorted.
        return { ok: true, body: ['2026-08-29', '2026-08-27', '2026-08-30'] };
      }
      if (url === `${LOGS_URL}/2026-08-29`) {
        return {
          ok: true,
          body: [
            {
              datetime: '2026-08-29T10:00:00.000Z',
              text: 'Departed the anchorage.',
              category: 'navigation',
              author: 'nearl',
              origin: 'manual',
              heading: 190,
              speed: { sog: 5.2 },
              barometer: 1013.25,
            },
          ],
        };
      }
      if (url === `${LOGS_URL}/2026-08-30`) {
        return {
          ok: true,
          body: [
            { datetime: '2026-08-30T08:00:00.000Z', text: '', origin: 'auto' },
            { datetime: '2026-08-30T09:00:00.000Z', text: 'Engine on.', category: 'engine' },
          ],
        };
      }
      return { ok: false, status: 404 };
    });

    const result = await fetchRecentEntries(ORIGIN, 'tok');
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.entries.map((entry) => entry.datetime)).toEqual([
      '2026-08-30T09:00:00.000Z',
      '2026-08-30T08:00:00.000Z',
      '2026-08-29T10:00:00.000Z',
    ]);
    // The default two-day window never touches the oldest listed day.
    const requested = mock.mock.calls.map((call) => call[0]);
    expect(requested).not.toContain(`${LOGS_URL}/2026-08-27`);
    // The plugin's display-unit numerics (degrees, knots, hPa) are not read into the entry.
    expect(result.entries[2]).toEqual({
      datetime: '2026-08-29T10:00:00.000Z',
      timeMs: Date.parse('2026-08-29T10:00:00.000Z'),
      text: 'Departed the anchorage.',
      category: 'navigation',
      author: 'nearl',
      origin: 'manual',
    });
    // The automatic hourly entry keeps its empty text rather than being dropped.
    expect(result.entries[1]?.text).toBe('');
    expect(result.entries[1]?.origin).toBe('auto');
  });

  it('skips invalid entries and malformed dates without failing the day', async () => {
    stubFetch((url) => {
      if (url === LOGS_URL) return { ok: true, body: ['2026-08-30', 'not-a-date', 42] };
      return {
        ok: true,
        body: [
          { datetime: 'not a datetime', text: 'bad' },
          'not a record',
          { datetime: '2026-08-30T09:00:00.000Z', text: 'Kept.', category: 'bogus' },
        ],
      };
    });
    const result = await fetchRecentEntries(ORIGIN, undefined);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.text).toBe('Kept.');
    expect(result.entries[0]?.category).toBeUndefined();
  });

  it('treats a day that 404s after listing as empty, not as a missing plugin', async () => {
    stubFetch((url) => {
      if (url === LOGS_URL) return { ok: true, body: ['2026-08-29', '2026-08-30'] };
      if (url === `${LOGS_URL}/2026-08-30`) {
        return { ok: true, body: [{ datetime: '2026-08-30T09:00:00.000Z', text: 'Kept.' }] };
      }
      return { ok: false, status: 404 };
    });
    const result = await fetchRecentEntries(ORIGIN, undefined);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.entries).toHaveLength(1);
  });

  it('reports a failed day read as error', async () => {
    stubFetch((url) => {
      if (url === LOGS_URL) return { ok: true, body: ['2026-08-30'] };
      return { ok: false, status: 500 };
    });
    await expect(fetchRecentEntries(ORIGIN, undefined)).resolves.toEqual({ state: 'error' });
  });

  it('maps listing outcomes: absent, unauthorized, malformed body, network failure', async () => {
    stubFetch({ ok: false, status: 404 });
    await expect(fetchRecentEntries(ORIGIN, undefined)).resolves.toEqual({ state: 'absent' });
    stubFetch({ ok: false, status: 403 });
    await expect(fetchRecentEntries(ORIGIN, undefined)).resolves.toEqual({ state: 'unauthorized' });
    stubFetch({ ok: true, body: { not: 'an array' } });
    await expect(fetchRecentEntries(ORIGIN, undefined)).resolves.toEqual({ state: 'error' });
    stubFetch('reject');
    await expect(fetchRecentEntries(ORIGIN, undefined)).resolves.toEqual({ state: 'error' });
  });
});

describe('createLogEntry', () => {
  it('posts the text with bearer auth and reports ok on 201', async () => {
    const mock = stubFetch({ ok: true, status: 201 });
    await expect(createLogEntry(ORIGIN, 'tok', 'Anchor down.')).resolves.toBe('ok');
    expect(mock).toHaveBeenCalledWith(LOGS_URL, expect.anything());
    const init = mock.mock.calls[0]?.[1];
    expectBearerAuth(init, 'tok');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ text: 'Anchor down.' });
  });

  it('includes the category when given', async () => {
    const mock = stubFetch({ ok: true, status: 201 });
    await createLogEntry(ORIGIN, 'tok', 'Oil changed.', { category: 'maintenance' });
    expect(JSON.parse(mock.mock.calls[0]?.[1]?.body as string)).toEqual({
      text: 'Oil changed.',
      category: 'maintenance',
    });
  });

  it('maps refusals and failures to bounded outcomes', async () => {
    stubFetch({ ok: false, status: 403 });
    await expect(createLogEntry(ORIGIN, 'tok', 'x')).resolves.toBe('access-denied');
    stubFetch({ ok: false, status: 404 });
    await expect(createLogEntry(ORIGIN, 'tok', 'x')).resolves.toBe('unavailable');
    stubFetch('reject');
    await expect(createLogEntry(ORIGIN, 'tok', 'x')).resolves.toBe('failed');
  });

  it('refuses empty text without a request', async () => {
    const mock = stubFetch({ ok: true, status: 201 });
    await expect(createLogEntry(ORIGIN, 'tok', '   ')).resolves.toBe('failed');
    expect(mock).not.toHaveBeenCalled();
  });
});
