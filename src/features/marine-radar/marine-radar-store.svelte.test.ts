import { describe, expect, it } from 'vitest';
import { MarineRadarStore } from './marine-radar-store.svelte';
import type { RadarInfo } from './radar-types';

const radar: RadarInfo = {
  id: 'a',
  name: 'A',
  status: 'standby',
  spokesPerRevolution: 2048,
  maxSpokeLen: 1024,
  range: 1852,
  controls: { gain: { value: 50 }, sea: { value: 20 } },
};

describe('MarineRadarStore', () => {
  it('selects the first radar on discovery and exposes it via selected', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([radar]);
    expect(store.selectedId).toBe('a');
    expect(store.selected?.name).toBe('A');
  });

  it('seeds controlValues from the discovered radar controls map', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([radar]);
    expect(store.controlValues.gain).toBe(50);
    expect(store.controlValues.sea).toBe(20);
  });

  it('records control values by id', () => {
    const store = new MarineRadarStore();
    store.setControlValue('gain', 42);
    expect(store.controlValues.gain).toBe(42);
  });

  it('seeds controlAuto from the discovered radar, only for controls reporting auto', () => {
    const autoRadar: RadarInfo = {
      ...radar,
      controls: { gain: { value: 50, auto: true }, sea: { value: 20, auto: false } },
    };
    const store = new MarineRadarStore();
    store.setDiscovered([autoRadar]);
    expect(store.controlAuto.gain).toBe(true);
    expect(store.controlAuto.sea).toBe(false);
  });

  it('records control auto state by id', () => {
    const store = new MarineRadarStore();
    store.setControlAuto('gain', true);
    expect(store.controlAuto.gain).toBe(true);
  });

  it('clears selection and radars when discovery is empty', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([radar]);
    store.setDiscovered([]);
    expect(store.selectedId).toBeUndefined();
    expect(store.selected).toBeUndefined();
  });

  it('seeds control values from the newly selected radar when selection changes', () => {
    const radarB: RadarInfo = {
      ...radar,
      id: 'b',
      name: 'B',
      controls: { gain: { value: 75 } },
    };
    const store = new MarineRadarStore();
    store.setDiscovered([radar, radarB]);
    store.setControlValue('gain', 99);
    store.select('b');
    expect(store.controlValues.gain).toBe(75);
    expect(store.controlValues.sea).toBeUndefined();
  });

  it('clears a stale read-only warning on a fresh discovery', () => {
    const store = new MarineRadarStore();
    store.setControlsForbidden(true);
    store.setDiscovered([radar]);
    expect(store.controlsForbidden).toBe(false);
  });

  it('seeds the operational status from the discovered radar', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([{ ...radar, status: 'transmit' }]);
    expect(store.operationalStatus).toBe('transmit');
  });

  it('reconciles status and control values from a state snapshot', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([radar]);
    store.reconcile(
      { power: { value: 'transmit' }, gain: { value: 80, auto: true }, sea: { value: 30 } },
      new Set(),
    );
    expect(store.operationalStatus).toBe('transmit');
    expect(store.controlValues.gain).toBe(80);
    expect(store.controlAuto.gain).toBe(true);
    expect(store.controlValues.sea).toBe(30);
  });

  it('reconcile does not clobber an in-flight optimistic write (a pending control)', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([radar]);
    store.setControlValue('gain', 99);
    store.reconcile({ gain: { value: 50 } }, new Set(['gain']));
    expect(store.controlValues.gain).toBe(99);
  });
});
