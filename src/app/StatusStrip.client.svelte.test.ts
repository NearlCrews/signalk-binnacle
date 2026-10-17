import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AnchorWatch } from '$entities/anchor';
import { UnitsStore } from '$entities/units';
import { OwnVessel } from '$entities/vessel';
import { NARROW_QUERY } from '$shared/lib';
import type { ConnectionPhase } from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage, stubMatchMedia } from '$shared/testing';
import DATA_CELLS_CSS from '../styles/data-cells.css?raw';
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
  // A phone carries no AIS cell, so degraded assessment goes on the caution line: inserting a cell
  // would shift every readout at the moment the hazard is reported.
  it('reports unassessed AIS targets on the caution line without shifting the readouts', () => {
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
    expect(target.querySelector('.lookout-notice')?.textContent).toContain(
      '2 AIS targets unassessed',
    );
  });
});
