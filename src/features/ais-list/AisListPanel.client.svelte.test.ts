import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AisTargets } from '$entities/ais';
import type { CollisionAssessment, DangerContact } from '$entities/collision';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import type { ConnectionPhase } from '$shared/signalk';
import { SignalKStore, type SKFrame } from '$shared/signalk';
import { fakeVesselFix } from '$shared/testing';
import AisListPanel from './AisListPanel.svelte';

const mounted: Array<() => void> = [];

function frame(targets: Record<string, Record<string, unknown>>, generation?: number): SKFrame {
  return {
    self: new Map(),
    ais: new Map(
      Object.entries(targets).map(([id, values]) => [id, new Map(Object.entries(values))]),
    ),
    connection: { phase: 'open', attempt: 0 },
    epoch: Date.now(),
    generation,
  };
}

function mountPanel(options: {
  targets: Record<string, Record<string, unknown>>;
  contacts?: DangerContact[];
  selectedId?: string;
  connectionPhase?: ConnectionPhase;
  noOwnPosition?: boolean;
}) {
  const store = new SignalKStore();
  store.applyFrame(frame(options.targets));
  const aisTargets = new AisTargets(store);
  const onSelect = vi.fn();
  const onLocate = vi.fn();
  const onClose = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(AisListPanel, {
      target,
      props: {
        aisTargets,
        clock: { now: Date.now() },
        vessel: fakeVesselFix(
          options.noOwnPosition ? undefined : { latitude: 42, longitude: -83 },
        ) as unknown as OwnVessel,
        collision: {
          assessment: { contacts: options.contacts ?? [], worst: 'clear', unassessed: [] },
        } as unknown as CollisionAssessment,
        units: { mode: 'metric' } as UnitsStore,
        connectionPhase: options.connectionPhase ?? 'open',
        selectedId: options.selectedId,
        onSelect,
        onLocate,
        onClose,
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const button = (text: string): HTMLButtonElement => {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.replaceAll(/\s+/g, ' ').trim() === text,
    );
    if (!found) throw new Error(`no button labeled ${text}`);
    return found;
  };
  return { store, target, onSelect, onLocate, onClose, button };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('AisListPanel interactions', () => {
  it('searches by MMSI and filters risk before rendering rows', () => {
    const risk = {
      id: 'vessels.urn:mrn:imo:mmsi:111111111',
      name: 'RISK',
      position: { latitude: 42.01, longitude: -83 },
      cpaMeters: 100,
      tcpaSeconds: 60,
      severity: 'danger',
      source: 'computed',
    } satisfies DangerContact;
    const panel = mountPanel({
      targets: {
        [risk.id]: {
          name: 'RISK',
          'navigation.position': risk.position,
        },
        'vessels.urn:mrn:imo:mmsi:222222222': {
          name: 'CLEAR',
          'navigation.position': { latitude: 42.02, longitude: -83 },
        },
      },
      contacts: [risk],
    });
    const search = panel.target.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('search input missing');
    search.value = '222222222';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    flushSync();

    expect(panel.target.textContent).toContain('CLEAR');
    expect(panel.target.textContent).not.toContain('RISKCollision risk');

    search.value = '';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    panel.button('Collision risks').click();
    flushSync();

    expect(panel.target.textContent).toContain('RISK');
    expect(panel.target.textContent).not.toContain('CLEAR');
  });

  it('finds a target beyond the 500-row cap through a native button', () => {
    const targets = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [
        `vessels.urn:mrn:imo:mmsi:${100_000_000 + index}`,
        {
          name: index === 500 ? 'ZZZ NEEDLE' : `VESSEL ${String(index).padStart(3, '0')}`,
          'navigation.position': { latitude: 42.01, longitude: -83 },
        },
      ]),
    );
    const panel = mountPanel({ targets });
    expect(panel.target.textContent).toContain('Showing the first 500 of 501 matches');
    const search = panel.target.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('search input missing');
    search.value = '100000500';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    flushSync();

    const result = [...panel.target.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('ZZZ NEEDLE'),
    );
    if (!result) throw new Error('target beyond cap missing after search');
    expect(result.tagName).toBe('BUTTON');
    result.click();

    expect(panel.onSelect).toHaveBeenCalledWith('vessels.urn:mrn:imo:mmsi:100000500');
  });

  it('uses one SlideOver for a live detail and names the ship type', () => {
    const id = 'vessels.urn:mrn:imo:mmsi:333333333';
    const panel = mountPanel({
      selectedId: id,
      targets: {
        [id]: {
          name: 'FREIGHTER',
          'navigation.position': { latitude: 42.01, longitude: -83 },
          'design.aisShipType': { id: 70 },
        },
      },
    });

    expect(panel.target.querySelectorAll('.slide-over')).toHaveLength(1);
    expect(panel.target.textContent).toContain('Cargo ship (70)');
    panel.button('Show on chart').click();
    expect(panel.onLocate).toHaveBeenCalledWith({ latitude: 42.01, longitude: -83 });
    panel.target
      .querySelector<HTMLButtonElement>('button[aria-label="Back to nearby vessels"]')
      ?.click();
    expect(panel.onSelect).toHaveBeenCalledWith(undefined);
  });

  it('clears the search from its own control and from Escape', () => {
    const panel = mountPanel({
      targets: {
        'vessels.urn:mrn:imo:mmsi:111111111': {
          name: 'RISK',
          'navigation.position': { latitude: 42.01, longitude: -83 },
        },
        'vessels.urn:mrn:imo:mmsi:222222222': {
          name: 'CLEAR',
          'navigation.position': { latitude: 42.02, longitude: -83 },
        },
      },
    });
    const search = panel.target.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('search input missing');
    const type = (value: string): void => {
      search.value = value;
      search.dispatchEvent(new InputEvent('input', { bubbles: true }));
      flushSync();
    };

    type('CLEAR');
    expect(panel.target.textContent).not.toContain('RISK');
    const clear = panel.target.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear the vessel search"]',
    );
    if (!clear) throw new Error('clear control missing');
    clear.click();
    flushSync();
    expect(search.value).toBe('');
    expect(panel.target.textContent).toContain('RISK');

    type('CLEAR');
    search.focus();
    flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(search.value).toBe('');
    expect(panel.onClose).not.toHaveBeenCalled();
  });

  it('leaves the distance sort in place through a lost fix, which orders by name meanwhile', () => {
    const panel = mountPanel({
      noOwnPosition: true,
      targets: {
        'vessels.urn:mrn:imo:mmsi:111111111': {
          name: 'ZULU',
          'navigation.position': { latitude: 42.01, longitude: -83 },
        },
        'vessels.urn:mrn:imo:mmsi:222222222': {
          name: 'ALPHA',
          'navigation.position': { latitude: 42.02, longitude: -83 },
        },
      },
    });

    expect(panel.button('Distance').getAttribute('aria-pressed')).toBe('true');
    expect(panel.button('Distance').disabled).toBe(true);
    const names = [...panel.target.querySelectorAll('.nav-name')].map((node) =>
      node.textContent?.trim(),
    );
    expect(names).toEqual(['ALPHA', 'ZULU']);
    expect(panel.target.textContent?.replace(/\s+/g, ' ')).toContain('ordered by name');
  });

  it('labels a dropped stream above a populated list', () => {
    const panel = mountPanel({
      connectionPhase: 'closed',
      targets: {
        'vessels.urn:mrn:imo:mmsi:111111111': {
          name: 'FROZEN',
          'navigation.position': { latitude: 42.01, longitude: -83 },
        },
      },
    });

    expect(panel.target.textContent).toContain('FROZEN');
    expect(panel.target.textContent).toContain('Signal K is disconnected.');
  });

  it('clears a selected target when the live entity expires it', () => {
    const id = 'vessels.urn:mrn:imo:mmsi:444444444';
    const panel = mountPanel({
      selectedId: id,
      targets: {
        [id]: {
          name: 'EXPIRING',
          'navigation.position': { latitude: 42.01, longitude: -83 },
        },
      },
    });

    panel.store.applyFrame(frame({}, 2));
    flushSync();

    expect(panel.onSelect).toHaveBeenCalledWith(undefined);
  });
});
