import { describe, expect, it } from 'vitest';
import { MarineRadarStore } from './marine-radar-store.svelte';
import { makeRadar } from './radar-test-fixtures';
import type { RadarInfo } from './radar-types';

// Built per test rather than shared: reconcile writes the applied controls back onto the RadarInfo
// the store was handed, so one fixture would carry a reconciled gain and status into the next test.
const twoControlRadar = (): RadarInfo =>
  makeRadar({ controls: { gain: { value: 50 }, sea: { value: 20 } } });

describe('MarineRadarStore', () => {
  it('selects the first radar on discovery and exposes it via selected', () => {
    const radar = twoControlRadar();
    const store = new MarineRadarStore();
    store.setDiscovered([radar]);
    expect(store.selectedId).toBe('a');
    expect(store.selected?.name).toBe('A');
  });

  it('seeds controlValues from the discovered radar controls map', () => {
    const radar = twoControlRadar();
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
    const autoRadar = makeRadar({
      controls: { gain: { value: 50, auto: true }, sea: { value: 20, auto: false } },
    });
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
    const radar = twoControlRadar();
    const store = new MarineRadarStore();
    store.setDiscovered([radar]);
    store.setDiscovered([]);
    expect(store.selectedId).toBeUndefined();
    expect(store.selected).toBeUndefined();
  });

  it('seeds control values from the newly selected radar when selection changes', () => {
    const radar = twoControlRadar();
    const radarB = makeRadar({ id: 'b', name: 'B', controls: { gain: { value: 75 } } });
    const store = new MarineRadarStore();
    store.setDiscovered([radar, radarB]);
    store.setControlValue('gain', 99);
    store.select('b');
    expect(store.controlValues.gain).toBe(75);
    expect(store.controlValues.sea).toBeUndefined();
  });

  it('clears a stale read-only warning on a fresh discovery', () => {
    const radar = twoControlRadar();
    const store = new MarineRadarStore();
    store.setControlsForbidden(true);
    store.setDiscovered([radar]);
    expect(store.controlsForbidden).toBe(false);
  });

  it('defends against duplicate radar and control identities', () => {
    const radar = twoControlRadar();
    const store = new MarineRadarStore();
    store.setDiscovered([
      radar,
      { ...radar },
      { ...radar, id: 'conflict', name: 'First' },
      { ...radar, id: 'conflict', name: 'Second' },
    ]);
    store.setCapabilities([
      { id: 'gain', name: 'Gain', dialect: 'v5', type: 'number' },
      { id: 'gain', name: 'Gain', dialect: 'v5', type: 'number' },
      { id: 'mode', name: 'First', dialect: 'v5', type: 'enum' },
      { id: 'mode', name: 'Second', dialect: 'v5', type: 'enum' },
    ]);

    expect(store.radars.map(({ id }) => id)).toEqual(['a']);
    expect(store.capabilities.map(({ id }) => id)).toEqual(['gain']);
  });

  it('seeds the operational status from the discovered radar', () => {
    const radar = twoControlRadar();
    const store = new MarineRadarStore();
    store.setDiscovered([{ ...radar, status: 'transmit' }]);
    expect(store.operationalStatus).toBe('transmit');
  });

  it('reconciles status and control values from a state snapshot', () => {
    const radar = twoControlRadar();
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
    const radar = twoControlRadar();
    const store = new MarineRadarStore();
    store.setDiscovered([radar]);
    store.setControlValue('gain', 99);
    store.reconcile({ gain: { value: 50 } }, new Set(['gain']));
    expect(store.controlValues.gain).toBe(99);
  });

  it('reconciles a status-spelled power control to the operational state', () => {
    const radar = twoControlRadar();
    const store = new MarineRadarStore();
    store.setDiscovered([radar]);
    store.reconcile({ status: { value: 'transmit' } }, new Set());
    expect(store.operationalStatus).toBe('transmit');
  });

  it('keeps the optimistic power pill against a status echo while the power write is pending', () => {
    const radar = twoControlRadar();
    const store = new MarineRadarStore();
    store.setDiscovered([radar]);
    store.setOperationalStatus('transmit');
    store.reconcile({ status: { value: 'standby' } }, new Set(['power']));
    expect(store.operationalStatus).toBe('transmit');
  });

  it('reconcileRadarControls updates a non-selected radar without touching the selection', () => {
    const radar = twoControlRadar();
    const radarB = makeRadar({ id: 'b', name: 'B', controls: { gain: { value: 25 } } });
    const store = new MarineRadarStore();
    store.setDiscovered([radar, radarB]);
    store.reconcileRadarControls('b', {
      gain: { value: 40 },
      power: { value: 'transmit' },
    });

    const b = store.radars.find((r) => r.id === 'b');
    expect(b?.controls.gain?.value).toBe(40);
    expect(b?.status).toBe('transmit');
    expect(store.selectedId).toBe('a');
    expect(store.controlValues.gain).toBe(50);
    expect(store.operationalStatus).toBe('standby');

    store.select('b');
    expect(store.operationalStatus).toBe('transmit');
    expect(store.controlValues.gain).toBe(40);
  });
});
