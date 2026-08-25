import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPwa } from './register.svelte';

const { instances } = vi.hoisted(() => ({
  instances: [] as { register: () => Promise<undefined> }[],
}));
vi.mock('virtual:serwist', () => ({
  getSerwist: async () => {
    const fake = {
      addEventListener: () => undefined,
      register: () => Promise.resolve(undefined),
      messageSkipWaiting: () => undefined,
    };
    instances.push(fake);
    return fake;
  },
}));

afterEach(() => {
  instances.length = 0;
});

describe('registerPwa status reactivity', () => {
  // The .svelte.ts module exists so panels can render the status live; the node suite compiles
  // the rune to a plain variable and passes identically without it, so only this browser test
  // proves a reactive reader actually re-evaluates on a transition.
  it('drives reactive readers through the registration transitions', async () => {
    const observed: string[] = [];
    let dispose!: () => void;
    flushSync(() => {
      dispose = $effect.root(() => {
        const pwa = registerPwa();
        $effect(() => {
          observed.push(pwa.status);
        });
      });
    });
    flushSync();
    expect(observed).toEqual(['pending']);

    // Registration settles across two awaits (getSerwist, then register).
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(observed).toEqual(['pending', 'active']);
    dispose();
  });
});
