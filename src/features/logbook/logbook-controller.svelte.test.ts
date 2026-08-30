import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubFetch } from '$shared/testing';
import { createLogbookController, type LogbookDeps } from './logbook-controller.svelte';

const ORIGIN = 'http://boat.local:3000';
const LOGS_URL = `${ORIGIN}/plugins/signalk-logbook/logs`;

afterEach(() => {
  vi.unstubAllGlobals();
});

function controllerWith(overrides: Partial<LogbookDeps> = {}) {
  const requestWriteAccess = vi.fn(async () => undefined);
  const controller = createLogbookController({
    origin: () => ORIGIN,
    getToken: () => 'tok',
    writeBlocked: () => false,
    requestWriteAccess,
    now: () => Date.parse('2026-08-30T12:00:00.000Z'),
    ...overrides,
  });
  return { controller, requestWriteAccess };
}

function stubServerWithOneEntry() {
  return stubFetch((url) => {
    if (url === LOGS_URL) return { ok: true, body: ['2026-08-30'] };
    if (url === `${LOGS_URL}/2026-08-30`) {
      return { ok: true, body: [{ datetime: '2026-08-30T09:00:00.000Z', text: 'Engine on.' }] };
    }
    return { ok: false, status: 404 };
  });
}

describe('logbook controller', () => {
  it('probes on start and loads entries once available', async () => {
    stubServerWithOneEntry();
    const { controller } = controllerWith();
    expect(controller.availability).toBe('unknown');
    controller.start();
    await vi.waitFor(() => expect(controller.loadState).toBe('ready'));
    expect(controller.availability).toBe('available');
    expect(controller.entries).toHaveLength(1);
    expect(controller.entries[0]?.text).toBe('Engine on.');
  });

  it('starts only once', async () => {
    const mock = stubServerWithOneEntry();
    const { controller } = controllerWith();
    controller.start();
    await vi.waitFor(() => expect(controller.loadState).toBe('ready'));
    const calls = mock.mock.calls.length;
    controller.start();
    await Promise.resolve();
    expect(mock.mock.calls.length).toBe(calls);
  });

  it('reports an absent plugin distinctly from a failed probe', async () => {
    stubFetch({ ok: false, status: 404 });
    const { controller } = controllerWith();
    await controller.recheck();
    expect(controller.availability).toBe('absent');

    stubFetch('reject');
    const failing = controllerWith().controller;
    await failing.recheck();
    expect(failing.availability).toBe('error');
  });

  it('keeps accepted entries through a transient refresh failure', async () => {
    stubServerWithOneEntry();
    const { controller } = controllerWith();
    await controller.recheck();
    expect(controller.entries).toHaveLength(1);

    stubFetch('reject');
    await controller.refresh();
    expect(controller.loadState).toBe('error');
    expect(controller.availability).toBe('available');
    expect(controller.entries).toHaveLength(1);
  });

  it('flips to unauthorized when the server starts refusing reads', async () => {
    stubServerWithOneEntry();
    const { controller } = controllerWith();
    await controller.recheck();

    stubFetch({ ok: false, status: 403 });
    await controller.refresh();
    expect(controller.availability).toBe('unauthorized');
  });

  it('refuses a write while blocked, without a request', async () => {
    const mock = stubFetch({ ok: true, status: 201 });
    const { controller } = controllerWith({ writeBlocked: () => true });
    await expect(controller.addEntry('Anchor down.')).resolves.toBe(false);
    expect(controller.error).toContain('Read-only access');
    expect(mock).not.toHaveBeenCalled();
  });

  it('refuses empty text with its own message', async () => {
    const mock = stubFetch({ ok: true, status: 201 });
    const { controller } = controllerWith();
    await expect(controller.addEntry('   ')).resolves.toBe(false);
    expect(controller.error).toBe('Enter the log text first.');
    expect(mock).not.toHaveBeenCalled();
  });

  it('logs an entry, echoes it immediately, and consumes the pending suggestion', async () => {
    stubServerWithOneEntry();
    const { controller } = controllerWith();
    await controller.recheck();
    controller.offerEntry('Anchor down, watch radius 40 m.');

    await expect(controller.addEntry('Anchor down, watch radius 40 m.')).resolves.toBe(true);
    expect(controller.entries[0]?.text).toBe('Anchor down, watch radius 40 m.');
    expect(controller.suggestion).toBeUndefined();
  });

  it('keeps the suggestion and asks for access again when the write is refused', async () => {
    stubFetch({ ok: false, status: 403 });
    const { controller, requestWriteAccess } = controllerWith();
    controller.offerEntry('Anchor down.');
    await expect(controller.addEntry('Anchor down.')).resolves.toBe(false);
    expect(controller.error).toContain('Signal K refused the write');
    expect(requestWriteAccess).toHaveBeenCalled();
    expect(controller.suggestion?.text).toBe('Anchor down.');
  });

  it('falls back to the landing state when the plugin disappears mid-session', async () => {
    stubServerWithOneEntry();
    const { controller } = controllerWith();
    await controller.recheck();

    stubFetch({ ok: false, status: 404 });
    await expect(controller.addEntry('Engine off.')).resolves.toBe(false);
    expect(controller.availability).toBe('absent');
    expect(controller.error).toContain('no longer available');
  });

  it('drops a second write while one is in flight', async () => {
    let release: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { controller } = controllerWith();

    const first = controller.addEntry('One.');
    await expect(controller.addEntry('Two.')).resolves.toBe(false);
    expect(controller.busy).toBe(true);
    release?.({ ok: true, status: 201, json: async () => undefined } as unknown as Response);
    await expect(first).resolves.toBe(true);
  });

  it('keeps one pending suggestion, newest wins, with its timestamp', () => {
    let at = 1_000;
    const { controller } = controllerWith({ now: () => at });
    controller.offerEntry('Navigation started.');
    at = 2_000;
    controller.offerEntry('Navigation stopped.');
    expect(controller.suggestion).toEqual({ text: 'Navigation stopped.', offeredAt: 2_000 });

    controller.offerEntry('   ');
    expect(controller.suggestion?.text).toBe('Navigation stopped.');

    controller.dismissSuggestion();
    expect(controller.suggestion).toBeUndefined();
  });
});
