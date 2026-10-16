import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnchoredMenu from './AnchoredMenu.svelte';
import SlideOver from './SlideOver.svelte';

const body = createRawSnippet(() => ({ render: () => '<p>Body</p>' }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

// Only the phone sheet query can match; nothing asks for reduced motion.
function stubViewport(phone: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query === '(max-width: 600px)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function firstTransform(animate: { mock: { calls: unknown[][] } }): string {
  const keyframes = animate.mock.calls[0]?.[0] as Keyframe[] | undefined;
  return String(keyframes?.[0]?.transform ?? '');
}

function mountPanel(): () => Promise<void> {
  const target = document.body.appendChild(document.createElement('div'));
  const panel = mount(SlideOver, {
    target,
    intro: true,
    props: { title: 'Layers', dock: 'right', onClose: () => undefined, children: body },
  });
  flushSync();
  return () => unmount(panel);
}

describe('surface arrival motion', () => {
  it('slides a docked panel in from its edge on a wide screen', async () => {
    stubViewport(false);
    const animate = vi.spyOn(Element.prototype, 'animate');
    const done = mountPanel();
    expect(firstTransform(animate)).toContain('translate(24px, 0px)');
    await done();
  });

  it('raises the panel from below where it is a phone sheet', async () => {
    stubViewport(true);
    const animate = vi.spyOn(Element.prototype, 'animate');
    const done = mountPanel();
    expect(firstTransform(animate)).toContain('translate(0px, 32px)');
    await done();
  });

  for (const [motion, expected] of [
    ['grow', /scale\(0\.9[12]/],
    ['rise', /translate\(0px, 32px\)/],
  ] as const) {
    it(`opens an anchored menu with its ${motion} motion`, async () => {
      stubViewport(false);
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
  }
});
