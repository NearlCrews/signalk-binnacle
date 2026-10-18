import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { AnchorWatch } from '$entities/anchor';
import { UnitsStore } from '$entities/units';
import { OwnVessel } from '$entities/vessel';
import { NARROW_QUERY } from '$shared/lib';
import type { ConnectionPhase } from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage, stubMatchMedia } from '$shared/testing';
import A11Y_CSS from '../styles/a11y.css?raw';
import BUTTONS_CSS from '../styles/buttons.css?raw';
import DATA_CELLS_CSS from '../styles/data-cells.css?raw';
import STRIPS_CSS from '../styles/strips.css?raw';
import TOKENS_CSS from '../styles/tokens.css?raw';
import StatusStrip from './StatusStrip.svelte';

// Browser-only suite: a hit target is a laid-out box, which only a real layout engine computes.
// The markup contract lives in StatusStrip.svelte.test.ts.

let sheet: HTMLStyleElement;
beforeAll(() => {
  sheet = document.createElement('style');
  sheet.textContent = `${TOKENS_CSS}\n${DATA_CELLS_CSS}`;
  document.head.append(sheet);
});
afterAll(() => {
  sheet.remove();
});

const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  vi.unstubAllGlobals();
});

describe('StatusStrip readout cells', () => {
  // Every readout is a full-height cell on the bar grid, so every tappable one, whether it explains
  // itself or opens a panel, is a full operational target.
  it('gives every tappable readout a full operational target', () => {
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
    const cells = target.querySelectorAll<HTMLButtonElement>('button.data-cell');
    const names = [...cells].map((cell) => cell.className);
    expect(names.some((name) => name.includes('anchor-readout'))).toBe(true);
    expect(names.some((name) => name.includes('depth-readout'))).toBe(true);
    for (const cell of cells) {
      const box = cell.getBoundingClientRect();
      expect(box.height, cell.className).toBeGreaterThanOrEqual(44);
      expect(box.width, cell.className).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('StatusStrip on a phone', () => {
  // A phone carries no AIS cell, so degraded assessment goes in the Status cell: inserting a cell
  // would shift every readout at the moment the hazard is reported.
  it('reports unassessed AIS targets in the Status cell without shifting the readouts', () => {
    stubMatchMedia((query) => query === NARROW_QUERY);
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    const anchor = new AnchorWatch(store, vessel, undefined, createFakeStorage());
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
        aisCount: 4,
        aisUnassessed: 2,
        anchor,
        units: new UnitsStore(),
        vessel,
        shallowAlarming: false,
        pinnedActions: [],
        clock: { now: Date.UTC(2026, 0, 1, 12, 0, 0) },
        onReconnect: () => {},
      },
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });
    flushSync();
    expect(target.querySelector('.slot-ais')).toBeNull();
    const cell = target.querySelector('.status-cell');
    expect(cell?.textContent).toContain('AIS gaps');
    expect(cell?.getAttribute('title')).toBe('2 AIS targets unassessed');
  });
});

describe('StatusStrip ends', () => {
  it('stands the menu and MOB the full height of a two-row bar, at its two edges', async () => {
    const previous = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(1400, 700);
    const layout = document.createElement('style');
    layout.textContent = `${BUTTONS_CSS}\n${STRIPS_CSS}\n${A11Y_CSS}`;
    document.head.append(layout);
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    const anchor = new AnchorWatch(store, vessel, undefined, createFakeStorage());
    const target = document.createElement('div');
    target.style.cssText = 'width:1400px;font-family:var(--font-ui);';
    document.body.append(target);
    const end = (label: string) =>
      createRawSnippet(() => ({
        render: () => `<button class="btn bar-bookend">${label}</button>`,
      }));
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
        pinnedActions: ['Center', 'Follow', 'Charts', 'Instruments'].map((label) => ({
          id: label,
          label,
          onSelect: () => {},
        })),
        clock: { now: Date.UTC(2026, 0, 1, 12, 0, 0) },
        onReconnect: () => {},
        start: end('Menu'),
        end: end('MOB'),
      },
    });
    try {
      flushSync();
      for (let frame = 0; frame < 4; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        flushSync();
      }
      const grid = target.querySelector<HTMLElement>('.strip-grid');
      const [menu, mob] = [...target.querySelectorAll<HTMLElement>('.bar-bookend')];
      if (!grid || !menu || !mob) throw new Error('bar parts missing');
      const box = grid.getBoundingClientRect();
      // Two rows: the readouts and the tiles.
      expect(target.querySelector('.pinned-actions')?.getBoundingClientRect().top).toBeGreaterThan(
        target.querySelector('.status-cell')?.getBoundingClientRect().bottom ?? Number.NaN,
      );
      for (const end of [menu, mob]) {
        const edge = end.getBoundingClientRect();
        expect(Math.abs(edge.height - box.height), end.textContent ?? '').toBeLessThanOrEqual(1);
      }
      expect(menu.getBoundingClientRect().left).toBeCloseTo(box.left, 0);
      expect(mob.getBoundingClientRect().right).toBeCloseTo(box.right, 0);
      // The tiles take whole bar columns, centered between the ends.
      const tiles = [...target.querySelectorAll<HTMLElement>('.bar-tile')];
      expect(tiles).toHaveLength(4);
      const left = (tiles[0]?.getBoundingClientRect().left ?? 0) - box.left;
      const right = box.right - (tiles[3]?.getBoundingClientRect().right ?? 0);
      expect(Math.abs(left - right)).toBeLessThanOrEqual(8);
    } finally {
      await unmount(component);
      target.remove();
      layout.remove();
      await page.viewport(previous.width, previous.height);
    }
  });
});
