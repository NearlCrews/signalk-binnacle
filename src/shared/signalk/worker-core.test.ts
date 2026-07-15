import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from '$shared/testing';
import type { Path, SKFrame } from './types';
import { WorkerCore } from './worker-core';

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: (t: number) => void) => setTimeout(() => cb(0), 0) as unknown as number,
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WorkerCore', () => {
  it('batches incoming deltas into one frame of self values', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (f) => frames.push(f));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.self',
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: 4.2 }] }],
      }),
    });
    vi.runAllTimers();
    expect(frames.at(-1)?.self.get('navigation.speedOverGround')).toBe(4.2);
  });

  it('delivers a subscription issued before connect once the socket opens', () => {
    const core = new WorkerCore();
    // The instrument dock restores a persisted-open state at App construction, before connect().
    core.subscribe([
      { path: 'environment.wind.speedOverGround' as Path, policy: 'instant', minPeriod: 1000 },
    ]);
    core.connect('ws://test', () => {});
    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(ws.sent.some((m) => m.includes('environment.wind.speedOverGround'))).toBe(true);
  });

  it('forwards subscribe messages to the socket', () => {
    const core = new WorkerCore();
    core.connect('ws://test', () => {});
    const ws = FakeWebSocket.instances[0];
    ws.open();
    core.subscribe([{ path: 'navigation.position' as Path, policy: 'instant', minPeriod: 1000 }]);
    expect(ws.sent.some((m) => m.includes('navigation.position'))).toBe(true);
  });

  it('routes own-vessel deltas to self and other vessels to ais', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (f) => frames.push(f));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({ name: 'sk', version: '1.0.0', self: 'vessels.self-urn' }),
    });
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.self-urn',
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: 5 }] }],
      }),
    });
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.other',
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: 9 }] }],
      }),
    });
    vi.runAllTimers();
    const frame = frames.at(-1);
    expect(frame?.self.get('navigation.speedOverGround')).toBe(5);
    expect(frame?.ais?.get('vessels.other')?.get('navigation.speedOverGround')).toBe(9);
    expect(frame?.ais?.get('vessels.self-urn')).toBeUndefined();
  });

  it('delivers a connection-only frame on each phase change, even without data', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (f) => frames.push(f));
    // The connecting phase reaches the store immediately, carrying no self values.
    expect(frames.at(-1)?.connection.phase).toBe('connecting');
    expect(frames.at(-1)?.self.size).toBe(0);
    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(frames.at(-1)?.connection.phase).toBe('open');
    // A dropped socket produces no data; the reconnecting phase must still reach the store so the
    // connection badge does not keep reading "Connected" through the outage.
    ws.close();
    expect(frames.at(-1)?.connection.phase).toBe('reconnecting');
    expect(frames.at(-1)?.self.size).toBe(0);
  });

  it('treats vessels.self context as own vessel', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (f) => frames.push(f));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.self',
        updates: [{ values: [{ path: 'navigation.headingTrue', value: 1 }] }],
      }),
    });
    vi.runAllTimers();
    expect(frames.at(-1)?.self.get('navigation.headingTrue')).toBe(1);
  });

  it('drops a malformed frame and continues delivering subsequent valid deltas', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (f) => frames.push(f));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({ data: 'this is not json {{{' });
    vi.runAllTimers();
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.self',
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: 2.5 }] }],
      }),
    });
    vi.runAllTimers();
    expect(frames.at(-1)?.self.get('navigation.speedOverGround')).toBe(2.5);
  });

  it('disconnect() fires no further frames after the batcher is drained', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (f) => frames.push(f));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.self',
        updates: [{ values: [{ path: 'navigation.headingTrue', value: 0.5 }] }],
      }),
    });
    core.disconnect();
    const countAfterDisconnect = frames.length;
    vi.runAllTimers();
    expect(frames.length).toBe(countAfterDisconnect);
  });

  it('reconnect() opens a new socket', () => {
    const core = new WorkerCore();
    core.connect('ws://test', () => {});
    expect(FakeWebSocket.instances).toHaveLength(1);
    core.reconnect();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('routes a self-URN delta to AIS before hello, then to self after hello arrives', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (f) => frames.push(f));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    // Delta for the self URN arrives before hello, so selfContext is not yet set.
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.urn:mrn:imo:mmsi:123456789',
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: 1 }] }],
      }),
    });
    vi.runAllTimers();
    // Without the hello, the URN is unknown self and is routed to AIS.
    expect(
      frames
        .at(-1)
        ?.ais?.get('vessels.urn:mrn:imo:mmsi:123456789')
        ?.get('navigation.speedOverGround'),
    ).toBe(1);
    expect(frames.at(-1)?.self.get('navigation.speedOverGround')).toBeUndefined();

    // Now the hello arrives, establishing the self URN.
    ws.onmessage?.({
      data: JSON.stringify({
        name: 'sk',
        version: '1.0.0',
        self: 'vessels.urn:mrn:imo:mmsi:123456789',
      }),
    });
    // A later delta for the same URN must now route to self.
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.urn:mrn:imo:mmsi:123456789',
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: 7 }] }],
      }),
    });
    vi.runAllTimers();
    expect(frames.at(-1)?.self.get('navigation.speedOverGround')).toBe(7);
  });
});
