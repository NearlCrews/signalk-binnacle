import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AnchorWatch } from '$entities/anchor';
import { UnitsStore } from '$entities/units';
import { OwnVessel } from '$entities/vessel';
import type { ConnectionPhase } from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage } from '$shared/testing';
import TOKENS_CSS from '../styles/tokens.css?raw';
import StatusStrip from './StatusStrip.svelte';

// Browser-only suite: a hit target is a laid-out box, which only a real layout engine computes.
// The markup contract lives in StatusStrip.svelte.test.ts.

let sheet: HTMLStyleElement;
beforeAll(() => {
  sheet = document.createElement('style');
  sheet.textContent = TOKENS_CSS;
  document.head.append(sheet);
});
afterAll(() => {
  sheet.remove();
});

const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
});

describe('StatusStrip anchor chip', () => {
  // The explain-tap chips keep a compact box by design (docs/design-system.md, section 9), but the
  // anchor chip opens Anchor watch, so like every other strip action it needs the full target.
  it('keeps a full operational target because it opens a panel', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    const anchor = new AnchorWatch(store, vessel, undefined, createFakeStorage());
    anchor.dropLocal({ latitude: 60, longitude: 24 }, 40);
    const target = document.createElement('div');
    document.body.append(target);
    const component = mount(StatusStrip, {
      target,
      props: {
        connectionLabel: 'Connected',
        streamError: false,
        dataStalled: false,
        online: true,
        fixStale: false,
        connectionPhase: 'open' as ConnectionPhase,
        aisCount: 0,
        anchor,
        units: new UnitsStore(),
        vessel,
        shallowAlarming: false,
        onEnableSound: () => {},
        pinnedActions: [],
        clock: { now: Date.UTC(2026, 0, 1, 12, 0, 0) },
        onReconnect: () => {},
        onOpenAnchor: () => {},
      },
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });
    flushSync();
    const chip = target.querySelector<HTMLButtonElement>('button.anchor-chip');
    if (!chip) throw new Error('Anchor chip did not render');
    const box = chip.getBoundingClientRect();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  });
});
