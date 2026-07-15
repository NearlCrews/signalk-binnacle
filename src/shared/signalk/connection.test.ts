import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from '$shared/testing';
import { SkConnection } from './connection';
import type { ConnectionState } from './types';

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SkConnection', () => {
  it('opens with subscribe=none and reports connecting then open', () => {
    const states: ConnectionState[] = [];
    const conn = new SkConnection('ws://test/signalk/v1/stream', {
      onState: (s) => states.push(s),
      onDelta: () => {},
    });
    conn.connect();
    expect(FakeWebSocket.instances[0].url).toContain('subscribe=none');
    expect(states.at(-1)?.phase).toBe('connecting');
    FakeWebSocket.instances[0].onopen?.();
    expect(states.at(-1)?.phase).toBe('open');
  });

  it('forwards raw messages to onDelta', () => {
    const deltas: string[] = [];
    const conn = new SkConnection('ws://test', {
      onState: () => {},
      onDelta: (d) => deltas.push(d),
    });
    conn.connect();
    FakeWebSocket.instances[0].onmessage?.({ data: '{"updates":[]}' });
    expect(deltas).toEqual(['{"updates":[]}']);
  });

  it('reconnects after close and reports reconnecting', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const states: ConnectionState[] = [];
    const conn = new SkConnection('ws://test', {
      onState: (s) => states.push(s),
      onDelta: () => {},
    });
    conn.connect();
    FakeWebSocket.instances[0].onopen?.();
    FakeWebSocket.instances[0].onclose?.();
    expect(states.at(-1)?.phase).toBe('reconnecting');
    vi.runOnlyPendingTimers();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('drops sends while connecting, then sends once open', () => {
    const conn = new SkConnection('ws://test', {
      onState: () => {},
      onDelta: () => {},
    });
    conn.connect();
    const ws = FakeWebSocket.instances[0];
    expect(() => conn.send({ subscribe: [] })).not.toThrow();
    expect(ws.sent).toHaveLength(0);
    ws.open();
    conn.send({ subscribe: [] });
    expect(ws.sent).toHaveLength(1);
  });

  it('resets the attempt counter on a successful open', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const states: ConnectionState[] = [];
    const conn = new SkConnection('ws://test', {
      onState: (s) => states.push(s),
      onDelta: () => {},
    });
    conn.connect();
    FakeWebSocket.instances[0].onclose?.();
    vi.runOnlyPendingTimers();
    FakeWebSocket.instances[1].onopen?.();
    expect(states.at(-1)).toMatchObject({ phase: 'open', attempt: 0 });
  });

  it('onerror closes the socket and schedules a reconnect', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const states: ConnectionState[] = [];
    const conn = new SkConnection('ws://test', {
      onState: (s) => states.push(s),
      onDelta: () => {},
    });
    conn.connect();
    // onerror calls ws.close(), which triggers onclose, which schedules a reconnect.
    FakeWebSocket.instances[0].onerror?.();
    expect(states.at(-1)?.phase).toBe('reconnecting');
    vi.runOnlyPendingTimers();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('disconnect() ends in closed and the stopped flag blocks any zombie reconnect', () => {
    const states: ConnectionState[] = [];
    const conn = new SkConnection('ws://test', {
      onState: (s) => states.push(s),
      onDelta: () => {},
    });
    conn.connect();
    FakeWebSocket.instances[0].open();
    conn.disconnect();
    expect(states.at(-1)?.phase).toBe('closed');
    // No new socket must be created even after timers fire.
    vi.runAllTimers();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
