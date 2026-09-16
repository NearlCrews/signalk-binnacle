import { describe, expect, it } from 'vitest';
import { mobClearNotification, mobNotification } from './mob-notification';

describe('mob notifications', () => {
  it('carries the capture epoch without retaining a mutable position reference', () => {
    const position = { latitude: 42, longitude: -83 };
    const value = mobNotification(position, 1_800_000_000_000);
    position.latitude = 43;
    expect(value.position?.latitude).toBe(42);
    expect(value.createdAt).toBe(new Date(1_800_000_000_000).toISOString());
  });
  it('raises an emergency with sound and the mark position', () => {
    const value = mobNotification({ latitude: 36.8, longitude: -121.79 });
    expect(value.state).toBe('emergency');
    expect(value.method).toContain('sound');
    expect(value.position).toEqual({ latitude: 36.8, longitude: -121.79 });
    expect(value.message).toContain('Man overboard');
  });

  it('raises a position-less emergency without a fix', () => {
    const value = mobNotification(undefined);
    expect(value.state).toBe('emergency');
    expect(value.method).toContain('sound');
    expect(value.position).toBeUndefined();
    expect(value.message).toContain('no position');
  });

  it('clears to normal with no methods', () => {
    const value = mobClearNotification();
    expect(value.state).toBe('normal');
    expect(value.method).toEqual([]);
  });
});
