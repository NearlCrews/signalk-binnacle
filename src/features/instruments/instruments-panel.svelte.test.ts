import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import InstrumentsPanel from './InstrumentsPanel.svelte';
import type { InstrumentsController } from './instruments-controller.svelte';
import type { TileDeps } from './tile-catalog';
import { TILE_CATALOG } from './tile-catalog';

// SSR-only suite (node environment, no DOM). Assertions are substring checks on the rendered body.

function makeStore(epochFor: (path: string) => number = () => 0) {
  return {
    cell: (path: string) => ({ epoch: epochFor(path), value: undefined }),
    notifications: new Map<string, unknown>(),
    notificationsVersion: 0,
    ensureCells: () => {},
  };
}

function makeController(overrides: Partial<InstrumentsController> = {}): InstrumentsController {
  return {
    open: true,
    tiles: [],
    selectedIds: [],
    toggleOpen: () => {},
    setOpen: () => {},
    toggleTile: () => {},
    reorderTile: () => {},
    zoneState: () => 'normal',
    dispose: () => {},
    ...overrides,
  };
}

// Two selected tiles, rest unselected, so we can test both selected and unselected rows.
const SELECTED_IDS = ['sog', 'heading'];

function makeDeps(epochFor?: (path: string) => number): TileDeps {
  return {
    store: makeStore(epochFor) as unknown as TileDeps['store'],
    vessel: {} as TileDeps['vessel'],
    units: {} as TileDeps['units'],
    clock: {} as TileDeps['clock'],
  };
}

describe('InstrumentsPanel', () => {
  it('renders the Instruments heading in the panel header', () => {
    const controller = makeController();
    const deps = makeDeps();
    const { body } = render(InstrumentsPanel, { props: { controller, deps } });
    expect(body).toContain('Instruments');
  });

  it('renders close button with aria-label "Close instruments dock" when not at full-screen breakpoint', () => {
    // matchMedia is absent in node, so the component falls back to the dock label.
    const controller = makeController();
    const deps = makeDeps();
    const { body } = render(InstrumentsPanel, { props: { controller, deps } });
    expect(body).toContain('aria-label="Close instruments dock"');
  });

  it('renders Customize button when in tile-display mode', () => {
    const controller = makeController();
    const deps = makeDeps();
    const { body } = render(InstrumentsPanel, { props: { controller, deps } });
    expect(body).toContain('Customize');
  });

  it('renders one labeled row per catalog entry when customizing is true', () => {
    const controller = makeController({ selectedIds: SELECTED_IDS });
    const deps = makeDeps();
    const { body } = render(InstrumentsPanel, {
      props: { controller, deps, customizing: true },
    });
    for (const def of TILE_CATALOG) {
      expect(body).toContain(def.label);
    }
  });

  it('renders a drag handle for each selected row in customize mode', () => {
    const controller = makeController({ selectedIds: SELECTED_IDS });
    const deps = makeDeps();
    const { body } = render(InstrumentsPanel, {
      props: { controller, deps, customizing: true },
    });
    // Each selected tile's handle has aria-label "Reorder <label>".
    for (const def of TILE_CATALOG.filter((d) => SELECTED_IDS.includes(d.id))) {
      expect(body).toContain(`Reorder ${def.label}`);
    }
    // Unselected tiles must not expose a handle.
    for (const def of TILE_CATALOG.filter((d) => !SELECTED_IDS.includes(d.id))) {
      expect(body).not.toContain(`Reorder ${def.label}`);
    }
  });

  it('shows UnavailableHint for never-reported rows but leaves their checkbox enabled', () => {
    // All cells report epoch 0, so every tile is "never-reported".
    const controller = makeController({ selectedIds: SELECTED_IDS });
    const deps = makeDeps(() => 0);
    const { body } = render(InstrumentsPanel, {
      props: { controller, deps, customizing: true },
    });
    // UnavailableHint renders a visually-hidden span with the hint text.
    expect(body).toContain('No data received from this sensor yet');
    // LayerToggle's checkbox must never carry the disabled attribute (checkbox stays enabled).
    expect(body).not.toContain('disabled');
  });

  it('does not show handles for never-reported unselected rows', () => {
    const controller = makeController({ selectedIds: [] });
    const deps = makeDeps(() => 0);
    const { body } = render(InstrumentsPanel, {
      props: { controller, deps, customizing: true },
    });
    for (const def of TILE_CATALOG) {
      expect(body).not.toContain(`Reorder ${def.label}`);
    }
  });

  it('carries no aria-live attribute anywhere in the panel', () => {
    const controller = makeController();
    const deps = makeDeps();
    const { body } = render(InstrumentsPanel, { props: { controller, deps } });
    expect(body).not.toContain('aria-live');
  });

  it('the reorder announcement span uses role="status" in customize mode', () => {
    const controller = makeController({ selectedIds: SELECTED_IDS });
    const deps = makeDeps();
    const { body } = render(InstrumentsPanel, {
      props: { controller, deps, customizing: true },
    });
    expect(body).toContain('role="status"');
  });
});
