import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPwa } from './register.svelte';

const { handlers } = vi.hoisted(() => ({
  handlers: [] as Array<Record<string, ((...args: unknown[]) => void) | undefined>>,
}));
vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: Record<string, (...args: unknown[]) => void>) => {
    handlers.push(options);
    return () => undefined;
  },
}));

afterEach(() => {
  handlers.length = 0;
});

describe('registerPwa status reactivity', () => {
  // The .svelte.ts module exists so panels can render the status live; the node suite compiles
  // the rune to a plain variable and passes identically without it, so only this browser test
  // proves a reactive reader actually re-evaluates on a transition.
  it('drives reactive readers through the registration transitions', () => {
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

    handlers.at(-1)?.onRegisteredSW?.();
    flushSync();
    expect(observed).toEqual(['pending', 'active']);
    dispose();
  });
});
