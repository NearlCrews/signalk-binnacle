import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import {
  AUTOPILOTS_PATH,
  adjustAutopilotTarget,
  discoverAutopilots,
  disengageAutopilot,
  engageAutopilot,
  fetchAutopilotInfo,
  gybeAutopilot,
  setAutopilotMode,
  tackAutopilot,
} from './autopilot-client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The verified wire shape: GET /autopilots answers an ID-KEYED RECORD, one entry per registered
// device, each carrying its provider plugin id and whether it is the server's default.
const TWO_PILOTS = {
  pypilot: { provider: 'pypilot-autopilot-provider', isDefault: true },
  backup: { provider: 'backup-provider', isDefault: false },
};

describe('discoverAutopilots', () => {
  it('parses the keyed device record and sends bearer auth', async () => {
    const mock = stubFetch({ ok: true, body: TWO_PILOTS });
    const discovery = await discoverAutopilots('http://sk', 'tok');
    expect(discovery.availability).toBe('available');
    expect(discovery.devices).toEqual([
      { id: 'pypilot', provider: 'pypilot-autopilot-provider', isDefault: true },
      { id: 'backup', provider: 'backup-provider', isDefault: false },
    ]);
    expect(mock.mock.calls[0][0]).toBe(`http://sk${AUTOPILOTS_PATH}`);
    expectBearerAuth(mock.mock.calls[0][1], 'tok');
  });

  it('reads an empty record as absent: a v2 server with no provider registered answers 200 {}', async () => {
    stubFetch({ ok: true, body: {} });
    expect((await discoverAutopilots('', undefined)).availability).toBe('absent');
  });

  it('reads a 404 as absent: a server without the v2 API', async () => {
    stubFetch({ ok: false, status: 404 });
    expect((await discoverAutopilots('', undefined)).availability).toBe('absent');
  });

  it('separates an auth refusal from absence', async () => {
    stubFetch({ ok: false, status: 403 });
    expect((await discoverAutopilots('', undefined)).availability).toBe('auth-required');
    stubFetch({ ok: false, status: 401 });
    expect((await discoverAutopilots('', undefined)).availability).toBe('auth-required');
  });

  it('reads a transport failure or a broken endpoint as unreachable, never absent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch({ ok: false, status: 500 });
    expect((await discoverAutopilots('', undefined)).availability).toBe('unreachable');
    stubFetch('reject');
    expect((await discoverAutopilots('', undefined)).availability).toBe('unreachable');
    stubFetch({ ok: true, body: [] });
    expect((await discoverAutopilots('', undefined)).availability).toBe('unreachable');
    expect(warn).toHaveBeenCalled();
  });

  it('drops unsafe and malformed device entries rather than the whole record', async () => {
    // JSON.parse makes __proto__ an OWN key, the way a hostile provider body arrives; an object
    // literal would assign the prototype instead and never reach the guard.
    stubFetch({
      ok: true,
      body: JSON.parse(
        `{"good":{"provider":"p","isDefault":false},"__proto__":{"provider":"evil","isDefault":true},"${'x'.repeat(200)}":{"provider":"p","isDefault":false},"bad":"not a record"}`,
      ),
    });
    const discovery = await discoverAutopilots('', undefined);
    expect(discovery.devices).toEqual([{ id: 'good', provider: 'p', isDefault: false }]);
    expect(discovery.availability).toBe('available');
  });
});

describe('fetchAutopilotInfo', () => {
  const INFO = {
    options: {
      states: [
        { name: 'auto', engaged: true },
        { name: 'standby', engaged: false },
      ],
      modes: ['compass', 'gps', 'wind'],
      actions: [
        { id: 'tack', name: 'Tack', available: true },
        { id: 'gybe', name: 'Gybe', available: false },
      ],
    },
    target: 0.326,
    mode: 'compass',
    state: 'auto',
    engaged: true,
  };

  it('parses the full device snapshot from the per-device route', async () => {
    const mock = stubFetch({ ok: true, body: INFO });
    const info = await fetchAutopilotInfo('http://sk', 'tok', 'pypilot');
    expect(mock.mock.calls[0][0]).toBe(`http://sk${AUTOPILOTS_PATH}/pypilot`);
    expect(info).toEqual(INFO);
  });

  it('encodes the device id into the URL', async () => {
    const mock = stubFetch({ ok: true, body: INFO });
    await fetchAutopilotInfo('', undefined, 'a b/c');
    expect(mock.mock.calls[0][0]).toBe(`${AUTOPILOTS_PATH}/a%20b%2Fc`);
  });

  it('bounds a malformed target to null and tolerates missing options', async () => {
    stubFetch({
      ok: true,
      body: { target: Number.NaN, mode: 7, state: null, engaged: 'yes' },
    });
    const info = await fetchAutopilotInfo('', undefined, 'p');
    expect(info).toEqual({
      options: { states: [], modes: [], actions: [] },
      target: null,
      mode: null,
      state: null,
      engaged: false,
    });
  });

  it('rejects an out-of-range target: the server clamps writes to the same closed range', async () => {
    stubFetch({ ok: true, body: { target: 100, engaged: false } });
    expect((await fetchAutopilotInfo('', undefined, 'p'))?.target).toBeNull();
  });

  it('resolves undefined on the no-provider error envelope and on transport failure', async () => {
    stubFetch({ ok: false, status: 500, body: { state: 'FAILED', statusCode: 400 } });
    expect(await fetchAutopilotInfo('', undefined, '_default')).toBeUndefined();
    stubFetch('reject');
    expect(await fetchAutopilotInfo('', undefined, '_default')).toBeUndefined();
  });
});

describe('command writes', () => {
  it('POSTs engage and disengage to the verified routes', async () => {
    let mock = stubFetch({ ok: true, body: { state: 'COMPLETED' } });
    expect(await engageAutopilot('http://sk', 'tok', 'pypilot')).toBe('ok');
    expect(mock.mock.calls[0][0]).toBe(`http://sk${AUTOPILOTS_PATH}/pypilot/engage`);
    expect(mock.mock.calls[0][1]?.method).toBe('POST');
    expectBearerAuth(mock.mock.calls[0][1], 'tok');
    mock = stubFetch({ ok: true, body: { state: 'COMPLETED' } });
    expect(await disengageAutopilot('http://sk', 'tok', 'pypilot')).toBe('ok');
    expect(mock.mock.calls[0][0]).toBe(`http://sk${AUTOPILOTS_PATH}/pypilot/disengage`);
  });

  it('PUTs the mode as a value envelope', async () => {
    const mock = stubFetch({ ok: true, body: { state: 'COMPLETED' } });
    await setAutopilotMode('', undefined, 'p', 'wind');
    expect(mock.mock.calls[0][0]).toBe(`${AUTOPILOTS_PATH}/p/mode`);
    expect(mock.mock.calls[0][1]?.method).toBe('PUT');
    expect(JSON.parse(mock.mock.calls[0][1]?.body as string)).toEqual({ value: 'wind' });
  });

  it('PUTs a relative target adjust in radians, the SI wire default', async () => {
    const mock = stubFetch({ ok: true, body: { state: 'COMPLETED' } });
    await adjustAutopilotTarget('', undefined, 'p', -0.1745);
    expect(mock.mock.calls[0][0]).toBe(`${AUTOPILOTS_PATH}/p/target/adjust`);
    expect(JSON.parse(mock.mock.calls[0][1]?.body as string)).toEqual({ value: -0.1745 });
  });

  it('POSTs tack and gybe with the direction in the path', async () => {
    let mock = stubFetch({ ok: true, body: { state: 'COMPLETED' } });
    await tackAutopilot('', undefined, 'p', 'port');
    expect(mock.mock.calls[0][0]).toBe(`${AUTOPILOTS_PATH}/p/tack/port`);
    mock = stubFetch({ ok: true, body: { state: 'COMPLETED' } });
    await gybeAutopilot('', undefined, 'p', 'starboard');
    expect(mock.mock.calls[0][0]).toBe(`${AUTOPILOTS_PATH}/p/gybe/starboard`);
  });

  it('maps the write grammar to outcomes: 403 refusal, 404 unavailable, network failed', async () => {
    stubFetch({ ok: false, status: 403, body: { state: 'FAILED', statusCode: 403 } });
    expect(await engageAutopilot('', undefined, 'p')).toBe('access-denied');
    stubFetch({ ok: false, status: 404 });
    expect(await engageAutopilot('', undefined, 'p')).toBe('unavailable');
    stubFetch('reject');
    expect(await engageAutopilot('', undefined, 'p')).toBe('failed');
    stubFetch({ ok: false, status: 500 });
    expect(await engageAutopilot('', undefined, 'p')).toBe('failed');
  });
});
