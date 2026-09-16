import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteWaypoint } from '$entities/route';
import RoutePointEditor from './RoutePointEditor.svelte';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup() {
  let accept = true;
  const target = document.createElement('div');
  document.body.append(target);
  const props = $state<ComponentProps<typeof RoutePointEditor>>({
    working: { id: 'draft', name: '', waypoints: [] },
    getChartCenter: () => ({ latitude: 42, longitude: -83 }),
    onSetWaypoints: vi.fn((waypoints: RouteWaypoint[]) => {
      if (!accept) return false;
      props.working = { ...props.working, waypoints };
      return true;
    }),
  });
  const component = mount(RoutePointEditor, { target, props });
  flushSync();
  cleanups.push(() => {
    void unmount(component);
    target.remove();
  });
  const button = (label: string) => {
    const found = [...target.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  };
  const click = (label: string) => {
    button(label).click();
    flushSync();
  };
  const latitude = async (value: number) => {
    const input = target.querySelector<HTMLInputElement>('input[aria-label^="Latitude"]');
    if (!input) throw new Error('Missing latitude');
    input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    await tick();
  };
  click('Edit route points without dragging');
  return {
    props,
    target,
    button,
    click,
    latitude,
    refuse: () => {
      accept = false;
    },
  };
}

describe('route coordinate controls', () => {
  it('reorders the selected named waypoint, retains selection, announces its position, and supports undo', async () => {
    const test = setup();
    const points = [
      {
        position: { latitude: 42, longitude: -83 },
        name: 'Harbor',
        metadata: { href: '/resources/waypoints/harbor' },
      },
      {
        position: { latitude: 43, longitude: -82 },
        name: 'Entrance',
        metadata: { href: '/resources/waypoints/entrance' },
      },
      { position: { latitude: 44, longitude: -81 }, name: 'Approach' },
    ];
    test.props.working = { ...test.props.working, waypoints: points };
    flushSync();
    expect(test.button('Move point earlier').disabled).toBe(true);
    expect(test.button('Move point later').disabled).toBe(true);
    const select = test.target.querySelector('select');
    if (!select) throw new Error('Missing route point selector');
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    test.button('Move point earlier').focus();
    test.click('Move point earlier');
    await tick();
    expect(test.props.working.waypoints).toEqual([points[1], points[0], points[2]]);
    expect(select.value).toBe('0');
    expect(test.button('Move point earlier').disabled).toBe(true);
    expect(document.activeElement).toBe(select);
    expect([...test.target.querySelectorAll('[role="status"]')].at(-1)?.textContent).toBe(
      'Entrance moved to position 1 of 3.',
    );
    test.click('Move point later');
    expect(test.props.working.waypoints).toEqual(points);
    expect(select.value).toBe('1');
    test.click('Undo point edit');
    expect(test.props.working.waypoints).toEqual([points[1], points[0], points[2]]);
    test.click('Undo point edit');
    expect(test.props.working.waypoints).toEqual(points);
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(test.button('Move point later').disabled).toBe(true);
  });

  it('does not reorder a disabled draft or change selection when replacement is refused', async () => {
    const test = setup();
    test.click('Add point');
    await test.latitude(43);
    test.click('Add point');
    const before = test.props.working.waypoints;
    test.props.disabled = true;
    flushSync();
    expect(test.button('Move point earlier').disabled).toBe(true);
    test.click('Move point earlier');
    expect(test.props.working.waypoints).toEqual(before);
    test.props.disabled = false;
    flushSync();
    test.refuse();
    test.click('Move point earlier');
    expect(test.props.working.waypoints).toEqual(before);
    expect(test.target.querySelector('select')?.value).toBe('1');
    expect(test.target.textContent).toContain('Point not changed');
  });

  it('shows the remaining selected point after deletion and follows an external move of that point', async () => {
    const test = setup();
    test.click('Add point');
    await test.latitude(43);
    test.click('Add point');
    await test.latitude(44);
    test.click('Add point');
    const select = test.target.querySelector('select');
    if (!select) throw new Error('Missing route point selector');
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    test.click('Delete selected point');
    const input = test.target.querySelector<HTMLInputElement>('input[aria-label^="Latitude"]');
    if (!input) throw new Error('Missing latitude input');
    expect(input.value).toBe('44');
    test.props.working = {
      ...test.props.working,
      waypoints: [test.props.working.waypoints[0], { position: { latitude: 45, longitude: -81 } }],
    };
    flushSync();
    expect(input.value).toBe('45');
    await test.latitude(46);
    expect(input.value).toBe('46');
    expect(test.props.working.waypoints[1].position.latitude).toBe(45);
  });

  it('creates, inserts, moves, deletes, and undoes route points without chart gestures', async () => {
    const test = setup();
    test.click('Add at chart center');
    await test.latitude(43);
    test.click('Add point');
    expect(test.props.working.waypoints.map((point) => point.position.latitude)).toEqual([42, 43]);
    await test.latitude(44);
    test.click('Insert after selected point');
    expect(test.props.working.waypoints.map((point) => point.position.latitude)).toEqual([
      42, 43, 44,
    ]);
    await test.latitude(45);
    test.click('Move selected point');
    expect(test.props.working.waypoints.at(-1)?.position.latitude).toBe(45);
    test.click('Delete selected point');
    expect(test.props.working.waypoints).toHaveLength(2);
    test.click('Undo point edit');
    expect(test.props.working.waypoints.at(-1)?.position.latitude).toBe(45);
    test.click('Undo point edit');
    expect(test.props.working.waypoints.at(-1)?.position.latitude).toBe(44);
  });

  it('keeps entered coordinates when the adapter refuses the edit and invalidates old undo after chart edits', async () => {
    const test = setup();
    test.click('Add point');
    expect(test.button('Undo point edit').disabled).toBe(false);
    test.props.working = {
      ...test.props.working,
      waypoints: [{ position: { latitude: 10, longitude: 20 } }],
    };
    flushSync();
    expect(test.button('Undo point edit').disabled).toBe(true);
    await test.latitude(46);
    test.refuse();
    test.click('Add point');
    expect(test.target.textContent).toContain('Point not changed');
    expect(
      test.target.querySelector<HTMLInputElement>('input[aria-label^="Latitude"]')?.value,
    ).toBe('46');
    expect(test.props.working.waypoints).toHaveLength(1);
  });
});
