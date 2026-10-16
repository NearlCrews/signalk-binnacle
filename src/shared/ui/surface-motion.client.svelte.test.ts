import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { cubicOut } from 'svelte/easing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NARROW_QUERY } from '$shared/lib';
import { stubMatchMedia } from '$shared/testing';
import AnchoredMenu from './AnchoredMenu.svelte';
import SlideOver from './SlideOver.svelte';
import { surfaceTransition } from './transitions';

const body = createRawSnippet(() => ({ render: () => '<p>Body</p>' }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

// Svelte plays a transition through Element.animate, so the first keyframe shows the arrival axis.
function firstTransform(animate: { mock: { calls: unknown[][] } }): string {
  const keyframes = animate.mock.calls[0]?.[0] as Keyframe[] | undefined;
  return String(keyframes?.[0]?.transform ?? '');
}

describe('surface arrival motion', () => {
  it.each([
    [false, 'translate(24px, 0px)'],
    [true, 'translate(0px, 32px)'],
  ] as const)('moves a docked panel in (phone sheet: %s)', async (phone, expected) => {
    stubMatchMedia((query) => phone && query === NARROW_QUERY);
    const animate = vi.spyOn(Element.prototype, 'animate');
    const target = document.body.appendChild(document.createElement('div'));
    const panel = mount(SlideOver, {
      target,
      intro: true,
      props: { title: 'Layers', dock: 'right', onClose: () => undefined, children: body },
    });
    flushSync();
    expect(firstTransform(animate)).toContain(expected);
    await unmount(panel);
  });

  it.each([
    ['grow', /scale\(0\.9[12]/],
    ['below', /translate\(0px, 32px\)/],
  ] as const)('opens an anchored menu with its %s motion', async (motion, expected) => {
    stubMatchMedia(() => false);
    const animate = vi.spyOn(Element.prototype, 'animate');
    const state = $state({ open: false });
    const target = document.body.appendChild(document.createElement('div'));
    const menu = mount(AnchoredMenu, {
      target,
      props: {
        get open() {
          return state.open;
        },
        motion,
        onClose: () => undefined,
        backdropLabel: 'Close',
        surfaceStyle: 'width:160px;height:96px;',
        children: body,
      },
    });
    flushSync();
    state.open = true;
    flushSync();
    expect(firstTransform(animate)).toMatch(expected);
    await unmount(menu);
  });

  it('times panels and menus on one curve', () => {
    stubMatchMedia(() => false);
    const node = document.body.appendChild(document.createElement('div'));
    expect(surfaceTransition(node, 'below')).toMatchObject({ duration: 180, easing: cubicOut });
    expect(surfaceTransition(node, 'grow')).toMatchObject({ duration: 140, easing: cubicOut });
  });

  it('holds every surface still under reduced motion', () => {
    stubMatchMedia((query) => query === '(prefers-reduced-motion: reduce)');
    const node = document.body.appendChild(document.createElement('div'));
    for (const motion of ['left', 'right', 'below', 'grow'] as const)
      expect(surfaceTransition(node, motion).duration).toBe(0);
  });
});
