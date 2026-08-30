import { afterEach, describe, expect, it, vi } from 'vitest';
import { vibrate } from './haptics';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('vibrate', () => {
  it('no-ops when navigator is absent entirely', () => {
    vi.stubGlobal('navigator', undefined);
    expect(() => vibrate(30)).not.toThrow();
  });

  it('no-ops when the platform has no Vibration API', () => {
    vi.stubGlobal('navigator', {});
    expect(() => vibrate(30)).not.toThrow();
  });

  it('forwards the pattern when the API exists', () => {
    const spy = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate: spy });
    vibrate([20, 40, 20]);
    expect(spy).toHaveBeenCalledWith([20, 40, 20]);
  });

  it('swallows a refusing implementation', () => {
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('not allowed');
      },
    });
    expect(() => vibrate(200)).not.toThrow();
  });
});
