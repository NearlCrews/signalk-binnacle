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

  // The store keys targets by full context, so the navigation-aid and SAR context families ride
  // the same AIS channel as vessels; a worker-side context filter would silently drop them.
  it('routes atons and sar contexts into the ais channel beside vessels', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (f) => frames.push(f));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'atons.urn:mrn:imo:mmsi:993672085',
        updates: [
          { values: [{ path: 'navigation.position', value: { latitude: 1, longitude: 2 } }] },
        ],
      }),
    });
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'sar.urn:mrn:imo:mmsi:111234567',
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: 51 }] }],
      }),
    });
    vi.runAllTimers();
    const frame = frames.at(-1);
    expect(frame?.ais?.get('atons.urn:mrn:imo:mmsi:993672085')?.get('navigation.position')).toEqual(
      { latitude: 1, longitude: 2 },
    );
    expect(
      frame?.ais?.get('sar.urn:mrn:imo:mmsi:111234567')?.get('navigation.speedOverGround'),
    ).toBe(51);
    expect(frame?.self.size).toBe(0);
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

  it('drops valid JSON primitives without interrupting subsequent deltas', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (frame) => frames.push(frame));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    for (const data of ['null', 'true', '42', '"hello"', '[]']) ws.onmessage?.({ data });
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.self',
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: 3 }] }],
      }),
    });
    vi.runAllTimers();
    expect(frames.at(-1)?.self.get('navigation.speedOverGround')).toBe(3);
  });

  it('drops an oversized text frame and continues with the next valid delta', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (frame) => frames.push(frame));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({ data: 'x'.repeat(1_048_577) });
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.self',
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: 6 }] }],
      }),
    });
    vi.runAllTimers();
    expect(frames.at(-1)?.self.get('navigation.speedOverGround')).toBe(6);
  });

  it('closes the previous socket when connect is called again', () => {
    const firstFrames: SKFrame[] = [];
    const secondFrames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://first', (frame) => firstFrames.push(frame));
    const first = FakeWebSocket.instances[0];
    core.connect('ws://second', (frame) => secondFrames.push(frame));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(first.readyState).toBe(WebSocket.CLOSED);
    first.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.self',
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: 99 }] }],
      }),
    });
    vi.runAllTimers();
    expect(secondFrames.some((frame) => frame.self.has('navigation.speedOverGround'))).toBe(false);
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

  it('setUrl() points the next reconnect at the new URL without dropping the live socket', () => {
    const core = new WorkerCore();
    core.connect('ws://test?token=old', () => {});
    const first = FakeWebSocket.instances[0];
    first.open();

    core.setUrl('ws://test?token=new');
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(first.readyState).toBe(WebSocket.OPEN);

    core.reconnect();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toContain('token=new');
    expect(FakeWebSocket.instances[1].url).not.toContain('token=old');
  });

  it('increments the connection generation on every successful open', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (frame) => frames.push(frame));
    FakeWebSocket.instances[0].open();
    expect(frames.at(-1)?.generation).toBe(1);
    core.reconnect();
    FakeWebSocket.instances[1].open();
    expect(frames.at(-1)?.generation).toBe(2);
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

  it('routes a staleness delta to the stales channel and suppresses the wire null', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (f) => frames.push(f));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.self',
        updates: [
          {
            $source: 'ttyUSB0.GP',
            timestamp: '2026-03-28T10:01:00.000Z',
            values: [
              {
                path: 'navigation.speedOverGround',
                value: null,
                state: {
                  timedOut: true,
                  lastValue: { timestamp: '2026-03-28T10:00:00Z', value: 5.5 },
                },
              },
            ],
          },
        ],
      }),
    });
    vi.runAllTimers();
    const frame = frames.at(-1);
    expect(frame?.self.has('navigation.speedOverGround')).toBe(false);
    const marker = frame?.selfStales?.get('navigation.speedOverGround');
    expect(marker?.sourceRef).toBe('ttyUSB0.GP');
    expect(marker?.lastValue?.value).toBe(5.5);
    // The provider timestamp parses in the past, so the receipt-time clamp leaves it as is.
    expect(marker?.lastValue?.epoch).toBe(Date.parse('2026-03-28T10:00:00Z'));
  });

  it('ignores a staleness state on a notifications path and on another vessel', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (f) => frames.push(f));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.self',
        updates: [
          {
            values: [
              { path: 'notifications.navigation.anchor', value: null, state: { timedOut: true } },
            ],
          },
        ],
      }),
    });
    ws.onmessage?.({
      data: JSON.stringify({
        context: 'vessels.other',
        updates: [
          {
            values: [
              { path: 'navigation.speedOverGround', value: null, state: { timedOut: true } },
            ],
          },
        ],
      }),
    });
    vi.runAllTimers();
    const frame = frames.at(-1);
    // The notifications null flows as an ordinary clearing value, not a marker.
    expect(frame?.self.get('notifications.navigation.anchor')).toBeNull();
    expect(frame?.selfStales).toBeUndefined();
    // The AIS null flows to the vessel bucket; the enforcer walks self only, but even a
    // non-compliant producer must not mark AIS cells.
    expect(frame?.ais?.get('vessels.other')?.get('navigation.speedOverGround')).toBeNull();
  });

  it('does not retain an oversized or control-bearing self context from hello', () => {
    const frames: SKFrame[] = [];
    const core = new WorkerCore();
    core.connect('ws://test', (frame) => frames.push(frame));
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    for (const self of [`vessels.${'x'.repeat(600)}`, 'vessels.bad\u0000context']) {
      ws.onmessage?.({ data: JSON.stringify({ name: 'sk', version: '1.0.0', self }) });
      ws.onmessage?.({
        data: JSON.stringify({
          context: 'vessels.self',
          updates: [{ values: [{ path: 'navigation.speedOverGround', value: 4 }] }],
        }),
      });
      vi.runAllTimers();
      expect(frames.at(-1)?.selfContext).toBeUndefined();
    }
  });
});
