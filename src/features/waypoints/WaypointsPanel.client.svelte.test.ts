import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import type { Waypoint } from '$entities/waypoint';
import type { AuthController } from '$shared/signalk';
import { fakeVesselFix } from '$shared/testing';
import WaypointsPanel from './WaypointsPanel.svelte';

const waypoints: Waypoint[] = [
  { id: 'a', name: 'Harbor Marina', position: { latitude: 44, longitude: -86 } },
  {
    id: 'b',
    name: 'Quiet Cove',
    position: { latitude: 45, longitude: -86 },
    description: 'Good holding in sand',
  },
  { id: 'c', name: 'North Basin', position: { latitude: 46, longitude: -86 } },
];

const mounted: Array<() => void> = [];

function mountPanel(auth: Partial<AuthController> = { writeBlocked: false }, selectedId?: string) {
  const target = document.createElement('div');
  const onGoTo = vi.fn();
  const onDelete = vi.fn();
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(WaypointsPanel, {
      target,
      props: {
        auth: auth as unknown as AuthController,
        waypoints,
        selectedId,
        vessel: fakeVesselFix(undefined) as unknown as OwnVessel,
        units: { mode: 'metric' } as UnitsStore,
        loadState: 'ready',
        busy: false,
        routeBusy: false,
        onRetry: vi.fn(),
        onLocate: vi.fn(),
        onGoTo,
        onEdit: vi.fn(),
        onDelete,
        onClose: vi.fn(),
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const search = target.querySelector<HTMLInputElement>('input[type="search"]');
  if (!search) throw new Error('the waypoints panel rendered no search field');
  return {
    target,
    onGoTo,
    onDelete,
    click: (label: string): void => {
      const button = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) =>
          candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label,
      );
      if (!button) throw new Error(`the waypoints panel rendered no ${label} control`);
      button.click();
      flushSync();
    },
    names: (): string[] =>
      [...target.querySelectorAll<HTMLButtonElement>('.saved button.name')].map(
        (button) => button.textContent?.trim() ?? '',
      ),
    type: (value: string): void => {
      search.value = value;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
    },
  };
}

afterEach(() => {
  for (const dispose of mounted.splice(0)) dispose();
});

describe('WaypointsPanel search', () => {
  it.each(['Navigate to waypoint', 'Delete waypoint'])(
    'returns focus to the same waypoint action after canceling %s',
    async (label) => {
      const panel = mountPanel();
      panel.type('cove');
      panel.click(label);
      expect(document.activeElement?.textContent).toBe('Cancel');
      panel.click('Cancel');
      await tick();
      expect(document.activeElement?.getAttribute('aria-label')).toBe(label);
      expect(document.activeElement?.closest('.card-frame')?.textContent).toContain('Quiet Cove');
      expect(panel.onGoTo).not.toHaveBeenCalled();
      expect(panel.onDelete).not.toHaveBeenCalled();
    },
  );

  it('does not take focus back when another control receives it during cancellation', async () => {
    const panel = mountPanel();
    panel.type('cove');
    panel.click('Delete waypoint');
    panel.click('Cancel');
    const search = panel.target.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('Missing waypoint search');
    search.focus();
    await tick();
    expect(document.activeElement).toBe(search);
  });

  it('names a search-excluded selected waypoint without claiming the result cap excluded it', () => {
    const panel = mountPanel({ writeBlocked: false }, 'a');
    panel.type('cove');
    expect(panel.target.textContent).toContain('It does not match the current search.');
    expect(panel.target.textContent).not.toContain('It is outside the displayed result limit.');
    expect(panel.names()).toEqual(['Harbor Marina', 'Quiet Cove']);
  });

  it('narrows the cards to the matching name', () => {
    const panel = mountPanel();
    expect(panel.names()).toHaveLength(3);
    panel.type('cove');
    expect(panel.names()).toEqual(['Quiet Cove']);
  });

  it('matches the description too', () => {
    const panel = mountPanel();
    panel.type('holding in sand');
    expect(panel.names()).toEqual(['Quiet Cove']);
  });

  it('says nothing matched instead of claiming there are no waypoints', () => {
    const panel = mountPanel();
    panel.type('nothing here');
    expect(panel.names()).toEqual([]);
    expect(panel.target.textContent).toContain('No waypoints match your search.');
  });

  it('closes an armed delete when the search hides its card', () => {
    const panel = mountPanel();
    panel.type('cove');
    panel.click('Delete waypoint');
    expect(panel.target.textContent).toContain('Delete this waypoint?');
    panel.type('harbor');
    panel.type('');
    expect(panel.target.textContent).not.toContain('Delete this waypoint?');
  });

  it('reorders the cards when a sort key is chosen', () => {
    const panel = mountPanel();
    const nameSort = [...panel.target.querySelectorAll<HTMLButtonElement>('.nav-sort button')].find(
      (button) => button.textContent?.trim().startsWith('Name'),
    );
    expect(nameSort?.getAttribute('aria-pressed')).toBe('true');
    expect(panel.names()).toEqual(['Harbor Marina', 'North Basin', 'Quiet Cove']);
    nameSort?.click();
    flushSync();
    expect(panel.names()).toEqual(['Quiet Cove', 'North Basin', 'Harbor Marina']);
  });
});

describe('WaypointsPanel write access', () => {
  it('requests read/write access from inside the panel that is blocked', () => {
    const requestWriteAccess = vi.fn(async () => {});
    const panel = mountPanel({ writeBlocked: true, requestWriteAccess });

    panel.click('Request read and write access');

    expect(requestWriteAccess).toHaveBeenCalledOnce();
  });

  it('rests the request control while one is outstanding', () => {
    const panel = mountPanel({ writeBlocked: true, upgrading: true });
    const button = [...panel.target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Requesting access…',
    );
    expect(button?.disabled).toBe(true);
  });
});
