import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RadarAreaControl from './RadarAreaControl.svelte';
import type { ControlDefinition, RadarAreaDraft, RadarControlEntry } from './radar-types';

const mounted: Array<() => void> = [];
const sectorDefinition: ControlDefinition = {
  id: 'noTransmitSector1',
  name: 'No-transmit sector 1',
  dialect: 'native',
  type: 'sector',
  range: { min: -Math.PI, max: Math.PI, step: Math.PI / 180, unit: 'rad' },
  hasEnabled: true,
};

function mountArea(
  definition: ControlDefinition = sectorDefinition,
  entry: RadarControlEntry = { value: -1, endValue: 1, enabled: false, allowed: true },
) {
  const target = document.createElement('div');
  document.body.append(target);
  const onSave = vi.fn();
  const onStartChartEdit = vi.fn(() => undefined);
  const onEditStateChange = vi.fn();
  const props = $state<ComponentProps<typeof RadarAreaControl>>({
    definition,
    entry,
    radarId: 'a',
    unitsMode: 'metric',
    controlsForbidden: false,
    pending: false,
    anotherEditorActive: false,
    areaDraft: undefined,
    onSave,
    onDraftChange: (draft: RadarAreaDraft | undefined) => {
      props.areaDraft = draft;
    },
    onStartChartEdit,
    onStopChartEdit: vi.fn(),
    onEditStateChange,
  });
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(RadarAreaControl, { target, props });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const click = (label: string): void => {
    const button = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`no button labeled ${label}`);
    button.click();
    flushSync();
  };
  return { target, props, onSave, onStartChartEdit, onEditStateChange, click };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('RadarAreaControl interactions', () => {
  it('requires a second explicit confirmation before saving a no-transmit sector', () => {
    const panel = mountArea();
    panel.click('Edit no-transmit sector');
    panel.click('Review sector save');
    expect(panel.target.textContent).toContain(
      'Apply this no-transmit sector and change the radar emission envelope?',
    );
    expect(panel.onSave).not.toHaveBeenCalled();

    panel.click('Apply sector');
    expect(panel.onSave).toHaveBeenCalledWith('noTransmitSector1', {
      value: -1,
      endValue: 1,
      enabled: false,
    });
  });

  it('starts explicit chart editing only from an active form draft', () => {
    const panel = mountArea();
    panel.click('Edit no-transmit sector');
    panel.click('Edit on chart');
    expect(panel.onStartChartEdit).toHaveBeenCalledWith('noTransmitSector1');
  });

  it('opens a fresh provider rectangle as a disabled draft and blocks its zero geometry', () => {
    const panel = mountArea(
      {
        id: 'exclusionRect1',
        name: 'Exclusion rectangle 1',
        dialect: 'native',
        type: 'rect',
        range: { min: 0, max: 100_000, unit: 'm' },
        hasEnabled: true,
        maxDistance: 100_000,
      },
      { value: 0, x1: 0, y1: 0, x2: 0, y2: 0, width: 0, allowed: true },
    );

    expect(panel.target.textContent).toContain('Rectangle disabled');
    panel.click('Edit exclusion rectangle');
    expect(panel.target.textContent).toContain('Width must be positive');
    const save = [...panel.target.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Save rectangle',
    );
    expect(save?.disabled).toBe(true);
  });

  it('releases local editor ownership when an external selection clears the draft', () => {
    const panel = mountArea();
    panel.click('Edit no-transmit sector');
    panel.onEditStateChange.mockClear();

    flushSync(() => {
      panel.props.areaDraft = undefined;
    });

    expect(panel.onEditStateChange).toHaveBeenCalledWith('noTransmitSector1', 'idle');
  });
});
