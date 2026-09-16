import { describe, expect, it, vi } from 'vitest';
import { SubscriptionRegistry } from './subscription-registry';
import type { Context, Path } from './types';

const path = (s: string) => s as Path;

describe('SubscriptionRegistry', () => {
  it('replaces the active set once when removing several paths and keeps releases idempotent', () => {
    const sent: unknown[] = [];
    const reg = new SubscriptionRegistry((message) => sent.push(message));
    const release = reg.add([{ path: 'one' }, { path: 'two' }]);
    reg.add([{ path: 'kept', context: 'vessels.*', policy: 'fixed', period: 2000 }]);
    sent.length = 0;
    release();
    release();
    expect(sent).toEqual([
      { context: '*', unsubscribe: [{ path: '*' }] },
      { context: 'vessels.*', subscribe: [{ path: 'kept', policy: 'fixed', period: 2000 }] },
    ]);
  });
  it('sends one subscribe on first demand for a path', () => {
    const sent: unknown[] = [];
    const reg = new SubscriptionRegistry((m) => sent.push(m));
    reg.add([{ path: path('navigation.position'), policy: 'instant', minPeriod: 1000 }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      context: 'vessels.self',
      subscribe: [{ path: 'navigation.position', policy: 'instant', minPeriod: 1000 }],
    });
  });

  it('refcounts: a second demand for the same path does not resubscribe', () => {
    const sent: unknown[] = [];
    const reg = new SubscriptionRegistry((m) => sent.push(m));
    reg.add([{ path: path('navigation.position') }]);
    reg.add([{ path: path('navigation.position') }]);
    expect(sent).toHaveLength(1);
  });

  it('unsubscribes only when the last demand is released', () => {
    const sent: unknown[] = [];
    const reg = new SubscriptionRegistry((m) => sent.push(m));
    const off1 = reg.add([{ path: path('navigation.position') }]);
    const off2 = reg.add([{ path: path('navigation.position') }]);
    off1();
    expect(sent).toHaveLength(1);
    off2();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      context: '*',
      unsubscribe: [{ path: '*' }],
    });
  });

  it('warns in dev when a second demand for a path carries different parameters', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reg = new SubscriptionRegistry(() => {});
      reg.add([{ path: path('navigation.position'), period: 200, policy: 'instant' }]);
      reg.add([{ path: path('navigation.position'), period: 5000, policy: 'instant' }]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('navigation.position');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn when a second demand matches the active parameters', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reg = new SubscriptionRegistry(() => {});
      reg.add([{ path: path('navigation.position'), period: 200, policy: 'instant' }]);
      reg.add([{ path: path('navigation.position'), period: 200, policy: 'instant' }]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('resubscribeAll re-sends every active subscription', () => {
    const sent: unknown[] = [];
    const reg = new SubscriptionRegistry((m) => sent.push(m));
    reg.add([{ path: path('navigation.position') }]);
    reg.add([{ path: path('navigation.headingTrue'), context: 'vessels.*' as Context }]);
    sent.length = 0;
    reg.resubscribeAll();
    expect(sent).toHaveLength(2);
  });

  it('remove drops demand so resubscribeAll does not resurrect it', () => {
    const sent: unknown[] = [];
    const reg = new SubscriptionRegistry((m) => sent.push(m));
    reg.add([{ path: path('navigation.position') }]);
    reg.remove([path('navigation.position')]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      context: '*',
      unsubscribe: [{ path: '*' }],
    });
    sent.length = 0;
    reg.resubscribeAll();
    expect(sent).toHaveLength(0);
  });

  it('remove with a non-self context drops only that context path and resubscribeAll skips it', () => {
    const sent: unknown[] = [];
    const reg = new SubscriptionRegistry((m) => sent.push(m));
    reg.add([
      { path: path('navigation.speedOverGround'), context: 'vessels.*' as Context },
      { path: path('navigation.headingTrue'), context: 'vessels.*' as Context },
    ]);
    reg.remove([path('navigation.speedOverGround')], 'vessels.*' as Context);
    sent.length = 0;
    reg.resubscribeAll();
    // Only the surviving path should be re-sent; the removed one must not reappear.
    const allSent = JSON.stringify(sent);
    expect(allSent).toContain('navigation.headingTrue');
    expect(allSent).not.toContain('navigation.speedOverGround');
  });
});
