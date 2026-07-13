import { describe, expect, it } from 'vitest';
import { createFakeMap } from '$shared/testing/fake-map';
import { LayerManager } from './layer-manager';
import type { OverlayContext, OverlayModule, ZBand } from './types';

function fakeCtx(): OverlayContext {
  return {
    map: createFakeMap() as never,
    beforeIdFor: () => undefined,
  };
}

function fakeOverlay(id: string, band: ZBand = 'traffic'): OverlayModule & { events: string[] } {
  const events: string[] = [];
  return {
    id,
    title: id,
    band,
    supportsOpacity: true,
    layerIds: [`${id}-layer`],
    events,
    add: () => {
      events.push('add');
    },
    remove: () => {
      events.push('remove');
    },
    setVisible: (_ctx, visible) => {
      events.push(`visible:${visible}`);
    },
    setOpacity: (_ctx, opacity) => {
      events.push(`opacity:${opacity}`);
    },
    reset: () => {
      events.push('reset');
    },
  };
}

describe('LayerManager', () => {
  it('adds an overlay on register and applies default state', async () => {
    const overlay = fakeOverlay('ais');
    const manager = new LayerManager(fakeCtx());
    await manager.register(overlay);
    expect(overlay.events).toContain('add');
    expect(overlay.events).toContain('visible:true');
    expect(overlay.events).toContain('opacity:1');
  });

  it('toggle drives setVisible', async () => {
    const overlay = fakeOverlay('ais');
    const manager = new LayerManager(fakeCtx());
    await manager.register(overlay);
    manager.toggle('ais', false);
    expect(overlay.events.at(-1)).toBe('visible:false');
  });

  it('setOpacity drives setOpacity', async () => {
    const overlay = fakeOverlay('ais');
    const manager = new LayerManager(fakeCtx());
    await manager.register(overlay);
    manager.setOpacity('ais', 0.4);
    expect(overlay.events.at(-1)).toBe('opacity:0.4');
  });

  it('unregister removes the overlay', async () => {
    const overlay = fakeOverlay('ais');
    const manager = new LayerManager(fakeCtx());
    await manager.register(overlay);
    manager.unregister('ais');
    expect(overlay.events.at(-1)).toBe('remove');
  });

  it('dispose removes every overlay once and is idempotent', async () => {
    const first = fakeOverlay('first');
    const second = fakeOverlay('second');
    const manager = new LayerManager(fakeCtx());
    await manager.registerAll([first, second]);

    manager.dispose();
    manager.dispose();

    expect(first.events.filter((event) => event === 'remove')).toHaveLength(1);
    expect(second.events.filter((event) => event === 'remove')).toHaveLength(1);
    expect(manager.layers()).toEqual([]);
  });

  it('dispose continues after one overlay cleanup throws', async () => {
    const first = fakeOverlay('first');
    const broken = fakeOverlay('broken');
    broken.remove = () => {
      throw new Error('cleanup failed');
    };
    const manager = new LayerManager(fakeCtx());
    await manager.registerAll([first, broken]);

    manager.dispose();

    expect(first.events).toContain('remove');
    expect(manager.layers()).toEqual([]);
  });

  it('unregister drops the id from the persisted snapshot and saved order', async () => {
    const changes: Array<Record<string, { visible: boolean; opacity: number }>> = [];
    const orders: string[][] = [];
    const manager = new LayerManager(fakeCtx(), {
      onChange: (s) => changes.push(s),
      onOrderChange: (o) => orders.push(o),
    });
    await manager.register(fakeOverlay('chart'));
    await manager.register(fakeOverlay('ais'));
    // Put both ids into the explicit order, then delete one.
    manager.reorder('chart', 0);
    manager.unregister('chart');
    expect(Object.keys(changes.at(-1) ?? {})).toEqual(['ais']);
    expect(orders.at(-1)).not.toContain('chart');
    expect(manager.layers().map((l) => l.id)).toEqual(['ais']);
  });

  it('rejects a duplicate id', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('ais'));
    await expect(manager.register(fakeOverlay('ais'))).rejects.toThrow();
  });

  it('rolls back a failed registration so the id can be retried', async () => {
    const manager = new LayerManager(fakeCtx());
    const broken = fakeOverlay('chart');
    broken.add = () => {
      throw new Error('bad source');
    };
    await expect(manager.register(broken)).rejects.toThrow('bad source');
    expect(manager.layers()).toEqual([]);
    await expect(manager.register(fakeOverlay('chart'))).resolves.toBeUndefined();
  });

  it('registerAll registers every module and yields the same band order as sequential register', async () => {
    const manager = new LayerManager(fakeCtx());
    const chart = fakeOverlay('chart', 'basemap');
    const vessel = fakeOverlay('vessel', 'vessel');
    const track = fakeOverlay('track', 'track');
    await manager.registerAll([chart, vessel, track]);
    expect(chart.events).toContain('add');
    expect(vessel.events).toContain('add');
    expect(track.events).toContain('add');
    // Identical to registering chart, vessel, then track one at a time.
    expect(manager.layers().map((l) => l.id)).toEqual(['vessel', 'track', 'chart']);
  });

  it('registerAll rejects a duplicate id', async () => {
    const manager = new LayerManager(fakeCtx());
    await expect(manager.registerAll([fakeOverlay('a'), fakeOverlay('a')])).rejects.toThrow();
  });

  it('reattachAll re-adds and restores state', async () => {
    const overlay = fakeOverlay('ais');
    const manager = new LayerManager(fakeCtx());
    await manager.register(overlay);
    manager.setOpacity('ais', 0.5);
    overlay.events.length = 0;
    await manager.reattachAll();
    expect(overlay.events).toContain('add');
    expect(overlay.events).toContain('opacity:0.5');
    // reset must precede the re-add so an overlay's recreated-empty source repopulates on next sync.
    expect(overlay.events.indexOf('reset')).toBeLessThan(overlay.events.indexOf('add'));
  });

  it('layers() returns overlays top of the map first', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('b'));
    // Same band, so b (registered later) sits above a; layers() lists the top layer first.
    expect(manager.layers().map((l) => l.id)).toEqual(['b', 'a']);
    expect(manager.layers()[0]).toMatchObject({ visible: true, opacity: 1 });
  });

  it('restores saved visibility and opacity on register', async () => {
    const overlay = fakeOverlay('ais');
    const manager = new LayerManager(fakeCtx(), {
      saved: { ais: { visible: false, opacity: 0.3 } },
    });
    await manager.register(overlay);
    expect(overlay.events).toContain('visible:false');
    expect(overlay.events).toContain('opacity:0.3');
  });

  it('coerces a malformed persisted entry on restore (missing opacity defaults to 1)', async () => {
    const overlay = fakeOverlay('ais');
    const manager = new LayerManager(fakeCtx(), {
      // A legacy entry that predates the opacity field, restored from localStorage as-is.
      saved: { ais: { visible: true } as never },
    });
    await manager.register(overlay);
    expect(overlay.events).toContain('visible:true');
    expect(overlay.events).toContain('opacity:1');
  });

  it('clamps an out-of-range persisted opacity on restore', async () => {
    const overlay = fakeOverlay('ais');
    const manager = new LayerManager(fakeCtx(), {
      saved: { ais: { visible: true, opacity: 7 } },
    });
    await manager.register(overlay);
    expect(overlay.events).toContain('opacity:1');
  });

  it('a layer with no saved entry takes the visible default', async () => {
    const overlay = fakeOverlay('charts');
    const manager = new LayerManager(fakeCtx(), { saved: { ais: { visible: false, opacity: 1 } } });
    await manager.register(overlay);
    expect(overlay.events).toContain('visible:true');
  });

  it('reports the full settings snapshot on toggle and opacity changes', async () => {
    const changes: Array<Record<string, { visible: boolean; opacity: number }>> = [];
    const manager = new LayerManager(fakeCtx(), { onChange: (s) => changes.push(s) });
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('b'));
    manager.toggle('a', false);
    manager.setOpacity('b', 0.5);
    expect(changes.at(-1)).toEqual({
      a: { visible: false, opacity: 1 },
      b: { visible: true, opacity: 0.5 },
    });
  });

  it('orders overlays by band by default, top of the map first', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('chart', 'basemap'));
    await manager.register(fakeOverlay('vessel', 'vessel'));
    await manager.register(fakeOverlay('track', 'track'));
    expect(manager.layers().map((l) => l.id)).toEqual(['vessel', 'track', 'chart']);
  });

  it('reorder moves a non-pinned layer and persists the new bottom-to-top order', async () => {
    const orders: string[][] = [];
    const manager = new LayerManager(fakeCtx(), { onOrderChange: (o) => orders.push(o) });
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('b'));
    await manager.register(fakeOverlay('c'));
    // Display order top to bottom starts [c, b, a]; move 'a' to the top.
    manager.reorder('a', 0);
    expect(manager.layers().map((l) => l.id)).toEqual(['a', 'c', 'b']);
    expect(orders.at(-1)).toEqual(['b', 'c', 'a']);
  });

  it('restores a saved order on register', async () => {
    const manager = new LayerManager(fakeCtx(), { savedOrder: ['b', 'c', 'a'] });
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('b'));
    await manager.register(fakeOverlay('c'));
    // Saved bottom-to-top [b, c, a] reads top to bottom as [a, c, b].
    expect(manager.layers().map((l) => l.id)).toEqual(['a', 'c', 'b']);
  });

  it('applies a module defaultOpacity when there is no saved state', async () => {
    const overlay = { ...fakeOverlay('field'), defaultOpacity: 0.6 };
    const manager = new LayerManager(fakeCtx());
    await manager.register(overlay);
    expect(overlay.events).toContain('opacity:0.6');
  });

  it('hides other members of an exclusive group when one is enabled', async () => {
    const manager = new LayerManager(fakeCtx(), { exclusive: [['a', 'b']] });
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('b'));
    manager.toggle('a', true);
    manager.toggle('b', true);
    const items = manager.layers();
    expect(items.find((i) => i.id === 'a')?.visible).toBe(false);
    expect(items.find((i) => i.id === 'b')?.visible).toBe(true);
  });

  it('does not restore two visible members of an exclusive group', async () => {
    const manager = new LayerManager(fakeCtx(), {
      exclusive: [['a', 'b']],
      saved: { a: { visible: true, opacity: 1 }, b: { visible: true, opacity: 1 } },
    });
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('b'));
    const items = manager.layers();
    expect(items.find((i) => i.id === 'a')?.visible).toBe(true);
    expect(items.find((i) => i.id === 'b')?.visible).toBe(false);
  });

  it('keeps pinned overlays on top and immovable', async () => {
    const manager = new LayerManager(fakeCtx(), { pinned: ['vessel'] });
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('vessel', 'vessel'));
    expect(manager.layers()[0]).toMatchObject({ id: 'vessel', pinned: true });
    manager.reorder('a', 0);
    expect(manager.layers()[0].id).toBe('vessel');
  });

  it('stacks a sub-layer directly above its parent and exposes the parent id', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('gebco', 'bathymetry'));
    await manager.register(fakeOverlay('chart', 'bathymetry'));
    await manager.register({ ...fakeOverlay('quality', 'bathymetry'), parent: 'chart' });
    // Top of the map first: the sub-layer sits just above its parent, both above gebco.
    expect(manager.layers().map((l) => l.id)).toEqual(['quality', 'chart', 'gebco']);
    expect(manager.layers().find((l) => l.id === 'quality')?.parent).toBe('chart');
  });

  it('does not reorder a sub-layer (it travels with its parent)', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('chart', 'bathymetry'));
    await manager.register({ ...fakeOverlay('quality', 'bathymetry'), parent: 'chart' });
    await manager.register(fakeOverlay('gebco', 'bathymetry'));
    manager.reorder('quality', 0);
    // Unchanged: quality stays pinned above chart regardless of the requested index.
    expect(manager.layers().map((l) => l.id)).toEqual(['gebco', 'quality', 'chart']);
  });

  it('reorder indices skip sub-layers so a parent move lands correctly', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('chart', 'bathymetry'));
    await manager.register({ ...fakeOverlay('quality', 'bathymetry'), parent: 'chart' });
    await manager.register(fakeOverlay('gebco', 'bathymetry'));
    // Top-level order top to bottom is [gebco, chart]; move chart to the top.
    manager.reorder('chart', 0);
    expect(manager.layers().map((l) => l.id)).toEqual(['quality', 'chart', 'gebco']);
  });

  it('turning a parent off hides its sub-layer', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('chart', 'bathymetry'));
    await manager.register({ ...fakeOverlay('quality', 'bathymetry'), parent: 'chart' });
    manager.toggle('quality', true);
    manager.toggle('chart', false);
    expect(manager.layers().find((l) => l.id === 'quality')?.visible).toBe(false);
  });

  it('applySnapshot drives setVisible and setOpacity for known layers', async () => {
    const a = fakeOverlay('a');
    const b = fakeOverlay('b');
    const manager = new LayerManager(fakeCtx());
    await manager.register(a);
    await manager.register(b);
    a.events.length = 0;
    b.events.length = 0;
    manager.applySnapshot(
      { a: { visible: false, opacity: 0.2 }, b: { visible: true, opacity: 0.5 } },
      ['a', 'b'],
    );
    expect(a.events).toContain('visible:false');
    expect(a.events).toContain('opacity:0.2');
    // b was already visible, so only its changed opacity is driven.
    expect(b.events).toContain('opacity:0.5');
    expect(b.events).not.toContain('visible:true');
  });

  it('applySnapshot ignores an unknown layer id without error', async () => {
    const overlay = fakeOverlay('a');
    const manager = new LayerManager(fakeCtx());
    await manager.register(overlay);
    expect(() =>
      manager.applySnapshot(
        { a: { visible: false, opacity: 1 }, ghost: { visible: true, opacity: 1 } },
        ['a'],
      ),
    ).not.toThrow();
    expect(manager.layers().find((l) => l.id === 'a')?.visible).toBe(false);
  });

  it('applySnapshot leaves a known id absent from settings unchanged', async () => {
    const a = fakeOverlay('a');
    const b = fakeOverlay('b');
    const manager = new LayerManager(fakeCtx());
    await manager.register(a);
    await manager.register(b);
    b.events.length = 0;
    manager.applySnapshot({ a: { visible: false, opacity: 1 } }, ['a', 'b']);
    // b is not in the snapshot, so it is neither re-driven nor changed.
    expect(b.events).toEqual([]);
    expect(manager.layers().find((l) => l.id === 'b')?.visible).toBe(true);
  });

  it('applySnapshot applies the new explicit order', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('b'));
    await manager.register(fakeOverlay('c'));
    manager.applySnapshot(
      {
        a: { visible: true, opacity: 1 },
        b: { visible: true, opacity: 1 },
        c: { visible: true, opacity: 1 },
      },
      ['c', 'b', 'a'],
    );
    // Bottom-to-top [c, b, a] reads top to bottom as [a, b, c].
    expect(manager.layers().map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('applySnapshot persists the snapshot exactly once, not per layer', async () => {
    const changes: Array<Record<string, { visible: boolean; opacity: number }>> = [];
    const manager = new LayerManager(fakeCtx(), { onChange: (s) => changes.push(s) });
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('b'));
    changes.length = 0;
    manager.applySnapshot(
      { a: { visible: false, opacity: 0.2 }, b: { visible: false, opacity: 0.3 } },
      ['a', 'b'],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      a: { visible: false, opacity: 0.2 },
      b: { visible: false, opacity: 0.3 },
    });
  });

  it('applySnapshot fires the order-change callback exactly once', async () => {
    const orders: string[][] = [];
    const manager = new LayerManager(fakeCtx(), { onOrderChange: (o) => orders.push(o) });
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('b'));
    orders.length = 0;
    manager.applySnapshot({ a: { visible: true, opacity: 1 }, b: { visible: true, opacity: 1 } }, [
      'b',
      'a',
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toEqual(['b', 'a']);
  });

  it('applySnapshot does not re-enforce exclusive groups (a saved profile is kept intact)', async () => {
    const manager = new LayerManager(fakeCtx(), { exclusive: [['a', 'b']] });
    await manager.register(fakeOverlay('a'));
    await manager.register(fakeOverlay('b'));
    // A profile captured both group members visible; applySnapshot honors it verbatim.
    manager.applySnapshot({ a: { visible: true, opacity: 1 }, b: { visible: true, opacity: 1 } }, [
      'a',
      'b',
    ]);
    const items = manager.layers();
    expect(items.find((i) => i.id === 'a')?.visible).toBe(true);
    expect(items.find((i) => i.id === 'b')?.visible).toBe(true);
  });

  it('reorder realizes the order on the map via moveLayer over the registered layers', async () => {
    const ctx = fakeCtx();
    const map = ctx.map as unknown as ReturnType<typeof createFakeMap>;
    // An overlay whose add() actually registers its layer, so #applyOrder finds it on the map and
    // chains moveLayer; the standard fakeOverlay only records events and adds no layer.
    const layerOverlay = (id: string): OverlayModule => ({
      id,
      title: id,
      band: 'traffic',
      supportsOpacity: true,
      layerIds: [`${id}-layer`],
      add: (c) => {
        c.map.addLayer({ id: `${id}-layer`, type: 'background' });
      },
      remove: () => {},
      setVisible: () => {},
    });
    const manager = new LayerManager(ctx);
    await manager.register(layerOverlay('a'));
    await manager.register(layerOverlay('b'));
    manager.reorder('a', 0);
    expect(map.moveLayer).toHaveBeenCalled();
    const moved = map.moveLayer.mock.calls.map((call) => call[0]);
    expect(moved).toEqual(expect.arrayContaining(['a-layer', 'b-layer']));
  });

  it('surfaces availability, the unavailable hint, and the manageable flag into layers()', async () => {
    const manager = new LayerManager(fakeCtx());
    let present = false;
    await manager.register({
      ...fakeOverlay('radar'),
      available: () => present,
      unavailableHint: 'No radar detected.',
      manageable: true,
    });
    await manager.register(fakeOverlay('plain'));
    const byId = () => new Map(manager.layers().map((l) => [l.id, l]));
    expect(byId().get('radar')?.available).toBe(false);
    expect(byId().get('radar')?.unavailableHint).toBe('No radar detected.');
    expect(byId().get('radar')?.manageable).toBe(true);
    // A module that declares no availability defaults to available and is not manageable.
    expect(byId().get('plain')?.available).toBe(true);
    expect(byId().get('plain')?.manageable).toBeUndefined();
    present = true;
    expect(byId().get('radar')?.available).toBe(true);
  });
});
