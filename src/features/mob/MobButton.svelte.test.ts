import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { MobStore } from '$entities/mob';
import { attribute, tag } from '$shared/testing';
import MobButton from './MobButton.svelte';

// Speech input users say the text they see, so the accessible name must contain the visible MOB.
describe('MobButton', () => {
  it.each([
    ['no mark', undefined],
    ['a mark', { latitude: 37.8, longitude: -122.4 }],
  ])('names the button by its visible MOB text with %s', (_, position) => {
    const mob = { position, active: position !== undefined } as unknown as MobStore;
    const { body } = render(MobButton, {
      props: { mob, onTrigger: vi.fn(), onLocate: vi.fn() },
    });

    const name = attribute(tag(body, /<button[^>]*mob-btn[^>]*>/, 'MOB button'), 'aria-label');
    expect(name).toMatch(/^MOB: /);
  });
});
