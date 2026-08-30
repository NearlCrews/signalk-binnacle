import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignalKStore, type SKFrame } from '$shared/signalk';
import { createFrameFactory } from '$shared/testing';
import { AUTOPILOTS_PATH } from './autopilot-client';
import { type AutopilotDeps, createAutopilotController } from './autopilot-controller.svelte';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DEVICES = {
  pypilot: { provider: 'pypilot-autopilot-provider', isDefault: true },
  backup: { provider: 'backup-provider', isDefault: false },
};

const INFO = {
  options: {
    states: [
      { name: 'auto', engaged: true },
      { name: 'standby', engaged: false },
    ],
    modes: ['compass', 'gps', 'wind'],
    actions: [{ id: 'tack', name: 'Tack', available: true }],
  },
  target: 1.5,
  mode: 'compass',
  state: 'auto',
  engaged: true,
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

// Routes discovery, per-device info, and command writes; a test overrides the piece it drives.
function stubRoutes(overrides: Partial<Record<'discovery' | 'info' | 'command', Handler>> = {}) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') {
      return overrides.command?.(url, init) ?? json({ state: 'COMPLETED' });
    }
    if (url.endsWith(AUTOPILOTS_PATH)) return overrides.discovery?.(url, init) ?? json(DEVICES);
    return overrides.info?.(url, init) ?? json(INFO);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function makeController(overrides: Partial<AutopilotDeps> = {}) {
  const store = new SignalKStore();
  const requestWriteAccess = vi.fn(async () => undefined);
  const controller = createAutopilotController({
    origin: '',
    getToken: () => undefined,
    apiAdvertised: () => true,
    writeBlocked: () => false,
    requestWriteAccess,
    store,
    ...overrides,
  });
  return { controller, store, requestWriteAccess };
}

function frameWithSource(frame: SKFrame, sourceId: string): SKFrame {
  frame.selfSources = new Map(
    [...frame.self.keys()].map((path) => [path, { label: sourceId, ref: sourceId }]),
  );
  return frame;
}

describe('rehydrate', () => {
  it('discovers devices, selects the default, and hydrates its snapshot', async () => {
    stubRoutes();
    const { controller } = makeController();
    await controller.rehydrate();
    expect(controller.availability).toBe('available');
    expect(controller.selectedId).toBe('pypilot');
    expect(controller.pilotState).toBe('auto');
    expect(controller.mode).toBe('compass');
    expect(controller.target).toBe(1.5);
    expect(controller.engaged).toBe(true);
    expect(controller.modes).toEqual(['compass', 'gps', 'wind']);
    expect(controller.availableActionIds.has('tack')).toBe(true);
    expect(controller.availableActionIds.has('gybe')).toBe(false);
  });

  it('reads an empty device record as absent and hides the chip', async () => {
    stubRoutes({ discovery: () => json({}) });
    const { controller } = makeController();
    await controller.rehydrate();
    expect(controller.availability).toBe('absent');
    expect(controller.chip).toEqual({ kind: 'hidden' });
    expect(controller.absentReason).toBe('no-provider');
  });

  it('names the missing API when the features roster rules it out', () => {
    const { controller } = makeController({ apiAdvertised: () => false });
    expect(controller.absentReason).toBe('no-api');
  });

  it('keeps devices and shows the lost chip when a working provider stops answering', async () => {
    stubRoutes();
    const { controller } = makeController();
    await controller.rehydrate();
    stubRoutes({ discovery: () => json({}, 500) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await controller.rehydrate();
    expect(warn).toHaveBeenCalled();
    expect(controller.availability).toBe('unreachable');
    expect(controller.devices).toHaveLength(2);
    expect(controller.chip).toEqual({ kind: 'lost' });
  });

  it('clears the snapshot when the provider is gone: a frozen picture must not survive', async () => {
    stubRoutes();
    const { controller } = makeController();
    await controller.rehydrate();
    expect(controller.engaged).toBe(true);
    stubRoutes({ discovery: () => json({}) });
    await controller.rehydrate();
    expect(controller.availability).toBe('absent');
    expect(controller.pilotState).toBeNull();
    expect(controller.engaged).toBe(false);
    // The session HAS seen a pilot, so absence now is a degraded treatment, not silence.
    expect(controller.chip).toEqual({ kind: 'lost' });
  });

  it('drops a stale device snapshot that resolves after a newer selection', async () => {
    let releaseSlow!: (value: Response) => void;
    const slow = new Promise<Response>((resolve) => {
      releaseSlow = resolve;
    });
    stubRoutes({
      info: (url) => (url.endsWith('/pypilot') ? slow : json({ ...INFO, mode: 'gps' })),
    });
    const { controller } = makeController();
    const first = controller.rehydrate();
    await vi.waitFor(() => {
      expect(controller.devices).toHaveLength(2);
    });
    controller.selectDevice('backup');
    await vi.waitFor(() => {
      expect(controller.mode).toBe('gps');
    });
    releaseSlow(json(INFO));
    await first;
    // The slow pypilot snapshot resolved after the backup selection and must not clobber it.
    expect(controller.mode).toBe('gps');
    expect(controller.selectedId).toBe('backup');
  });
});

describe('stream reconcile', () => {
  it('overlays values streamed after the snapshot and maps engaged from the provider states', async () => {
    stubRoutes();
    const { controller, store } = makeController();
    await controller.rehydrate();
    const frame = createFrameFactory(Date.now());
    store.applyFrame(
      frameWithSource(
        frame({ 'steering.autopilot.state': 'standby', 'steering.autopilot.mode': 'wind' }),
        'pypilot',
      ),
    );
    expect(controller.pilotState).toBe('standby');
    expect(controller.mode).toBe('wind');
    expect(controller.engaged).toBe(false);
    expect(controller.chip).toEqual({ kind: 'standby' });
  });

  it('ignores a sample from a non-selected pilot when several devices share the bus', async () => {
    stubRoutes();
    const { controller, store } = makeController();
    await controller.rehydrate();
    const frame = createFrameFactory(Date.now());
    store.applyFrame(frameWithSource(frame({ 'steering.autopilot.state': 'standby' }), 'backup'));
    expect(controller.pilotState).toBe('auto');
    store.applyFrame(frameWithSource(frame({ 'steering.autopilot.state': 'standby' }), 'pypilot'));
    expect(controller.pilotState).toBe('standby');
  });

  it('ignores a malformed streamed value rather than replacing the snapshot', async () => {
    stubRoutes();
    const { controller, store } = makeController();
    await controller.rehydrate();
    const frame = createFrameFactory(Date.now());
    store.applyFrame(
      frameWithSource(
        frame({
          'steering.autopilot.target': { some: 'object' },
          'steering.autopilot.mode': 'x'.repeat(1000),
        }),
        'pypilot',
      ),
    );
    expect(controller.target).toBe(1.5);
    expect(controller.mode).toBe('compass');
  });

  it('follows a streamed default-pilot change while the navigator has not chosen a device', async () => {
    stubRoutes();
    const { controller, store } = makeController();
    await controller.rehydrate();
    const frame = createFrameFactory(Date.now());
    store.applyFrame(frame({ 'steering.autopilot.defaultPilot': 'backup' }));
    expect(controller.selectedId).toBe('backup');
    controller.selectDevice('pypilot');
    expect(controller.selectedId).toBe('pypilot');
  });

  it('presents the engaged chip with mode and target for the strip', async () => {
    stubRoutes();
    const { controller } = makeController();
    await controller.rehydrate();
    expect(controller.chip).toEqual({
      kind: 'engaged',
      mode: 'compass',
      targetRad: 1.5,
      windMode: false,
    });
  });
});

describe('commands', () => {
  it('engages through the write path and reports the pilot engaged optimistically', async () => {
    const mock = stubRoutes({
      discovery: () => json(DEVICES),
      info: () => json({ ...INFO, engaged: false, state: 'standby' }),
    });
    const { controller } = makeController();
    await controller.rehydrate();
    expect(controller.engaged).toBe(false);
    await controller.engage();
    const engageCall = mock.mock.calls.find(([url]) => String(url).endsWith('/engage'));
    expect(engageCall?.[0]).toBe(`${AUTOPILOTS_PATH}/pypilot/engage`);
    expect(controller.commandError).toBeNull();
    expect(controller.engaged).toBe(true);
  });

  it('blocks every command without write access instead of sending it', async () => {
    const mock = stubRoutes();
    const { controller } = makeController({ writeBlocked: () => true });
    await controller.rehydrate();
    const writesBefore = mock.mock.calls.filter(([, init]) => init?.method === 'POST').length;
    await controller.engage();
    expect(controller.commandError).toContain('Read-only access');
    controller.adjustTarget(0.1);
    await controller.tack('port');
    expect(mock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
      writesBefore,
    );
  });

  it('turns a refused command into a message and a fresh access request', async () => {
    stubRoutes({ command: () => json({ state: 'FAILED' }, 403) });
    const { controller, requestWriteAccess } = makeController();
    await controller.rehydrate();
    await controller.disengage();
    expect(controller.commandError).toContain('refused the disengage command');
    expect(requestWriteAccess).toHaveBeenCalled();
  });

  it('drops a second command while one is in flight', async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const mock = stubRoutes({ command: () => gate });
    const { controller } = makeController();
    await controller.rehydrate();
    const first = controller.engage();
    const second = controller.engage();
    release(json({ state: 'COMPLETED' }));
    await Promise.all([first, second]);
    expect(mock.mock.calls.filter(([url]) => String(url).endsWith('/engage'))).toHaveLength(1);
  });

  it('validates a mode against the provider options before writing', async () => {
    const mock = stubRoutes();
    const { controller } = makeController();
    await controller.rehydrate();
    await controller.setMode('warp-drive');
    expect(mock.mock.calls.some(([url]) => String(url).endsWith('/mode'))).toBe(false);
    await controller.setMode('wind');
    const call = mock.mock.calls.find(([url]) => String(url).endsWith('/mode'));
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({ value: 'wind' });
    expect(controller.mode).toBe('wind');
  });

  it('coalesces queued nudges into one in-flight adjust instead of dropping them', async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let adjustCalls = 0;
    const bodies: number[] = [];
    stubRoutes({
      command: (url, init) => {
        if (!url.endsWith('/target/adjust')) return json({ state: 'COMPLETED' });
        adjustCalls += 1;
        bodies.push((JSON.parse(init?.body as string) as { value: number }).value);
        return adjustCalls === 1 ? gate : json({ state: 'COMPLETED' });
      },
    });
    const { controller } = makeController();
    await controller.rehydrate();
    controller.adjustTarget(0.1);
    controller.adjustTarget(0.1);
    controller.adjustTarget(-0.05);
    release(json({ state: 'COMPLETED' }));
    await vi.waitFor(() => {
      expect(controller.adjustBusy).toBe(false);
    });
    // The first tap went out alone; the two taps queued behind it coalesced into their sum.
    expect(bodies[0]).toBeCloseTo(0.1);
    expect(bodies[1]).toBeCloseTo(0.05);
    expect(adjustCalls).toBe(2);
  });

  it('rejects a nudge at the action boundary while the pilot is on standby', async () => {
    const mock = stubRoutes({ info: () => json({ ...INFO, engaged: false, state: 'standby' }) });
    const { controller } = makeController();
    await controller.rehydrate();
    controller.adjustTarget(0.1);
    expect(mock.mock.calls.some(([url]) => String(url).endsWith('/target/adjust'))).toBe(false);
  });

  it('moves the displayed target with an accepted nudge and holds through the reconcile', async () => {
    // The reconcile fetch answers the post-adjust truth, so the optimistic bump and the follow-up
    // REST snapshot agree and the readout never snaps back.
    let adjusted = false;
    stubRoutes({
      command: (url) => {
        if (url.endsWith('/target/adjust')) adjusted = true;
        return json({ state: 'COMPLETED' });
      },
      info: () => json({ ...INFO, target: adjusted ? 1.6 : 1.5 }),
    });
    const { controller } = makeController();
    await controller.rehydrate();
    controller.adjustTarget(0.1);
    expect(controller.target).toBeCloseTo(1.5);
    await vi.waitFor(() => {
      expect(controller.adjustBusy).toBe(false);
    });
    expect(controller.target).toBeCloseTo(1.6);
  });
});
