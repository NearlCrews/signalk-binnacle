import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeClientHeight } from './observe-client-height';

function setup() {
  let height = 0;
  const readHeight = vi.fn(() => height);
  const node = {
    get clientHeight() {
      return readHeight();
    },
  } as HTMLElement;
  const onHeight = vi.fn();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  const cancelFrame = vi.fn((id: number) => frames.delete(id));
  const observe = vi.fn();
  const disconnect = vi.fn();
  let notify = (): void => {};
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const action = observeClientHeight(node, onHeight);
  return {
    action,
    node,
    onHeight,
    readHeight,
    observe,
    disconnect,
    requestFrame,
    cancelFrame,
    frames,
    notify: () => notify(),
    setHeight: (next: number) => {
      height = next;
    },
    flush: () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('observeClientHeight', () => {
  it('defers the initial layout read and coalesces observer deliveries into one frame', () => {
    const test = setup();
    expect(test.observe.mock.calls[0]?.[0]).toBe(test.node);
    expect(test.observe.mock.calls[0]?.[1]).toEqual({ box: 'border-box' });
    test.notify();
    test.notify();
    test.setHeight(164);
    expect(test.readHeight).not.toHaveBeenCalled();
    expect(test.onHeight).not.toHaveBeenCalled();
    expect(test.requestFrame).toHaveBeenCalledTimes(1);
    test.flush();
    expect(test.readHeight).toHaveBeenCalledTimes(1);
    expect(test.onHeight).toHaveBeenCalledExactlyOnceWith(164);
    test.action.destroy();
  });

  it('reports changed heights, including zero, without repeating unchanged values', () => {
    const test = setup();
    test.setHeight(164);
    test.flush();
    test.notify();
    test.flush();
    expect(test.onHeight).toHaveBeenCalledTimes(1);
    test.setHeight(44);
    test.notify();
    test.flush();
    test.setHeight(0);
    test.notify();
    test.flush();
    expect(test.onHeight.mock.calls).toEqual([[164], [44], [0]]);
    test.action.destroy();
  });

  it('uses an updated handler and delivers its current height in the next frame', () => {
    const test = setup();
    test.setHeight(44);
    test.flush();
    const next = vi.fn();
    test.action.update(next);
    expect(next).not.toHaveBeenCalled();
    test.notify();
    test.flush();
    expect(next).toHaveBeenCalledExactlyOnceWith(44);
    expect(test.onHeight).toHaveBeenCalledTimes(1);
    test.action.destroy();
  });

  it('disconnects and cancels queued work, and ignores callbacks delivered after teardown', () => {
    const test = setup();
    const queued = test.frames.values().next().value;
    if (!queued) throw new Error('Expected a pending measurement');
    test.action.destroy();
    expect(test.disconnect).toHaveBeenCalledOnce();
    expect(test.cancelFrame).toHaveBeenCalledExactlyOnceWith(1);
    expect(test.frames.size).toBe(0);
    test.notify();
    queued(0);
    expect(test.requestFrame).toHaveBeenCalledTimes(1);
    expect(test.readHeight).not.toHaveBeenCalled();
    expect(test.onHeight).not.toHaveBeenCalled();
  });
});
