import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import type { Waypoint } from '$entities/waypoint';
import type { AuthController } from '$shared/signalk';
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

function mountPanel() {
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(WaypointsPanel, {
      target,
      props: {
        auth: { writeBlocked: false } as AuthController,
        waypoints,
        vessel: { position: undefined, positionStale: false } as unknown as OwnVessel,
        units: { mode: 'metric' } as UnitsStore,
        loadState: 'ready',
        busy: false,
        routeBusy: false,
        onRetry: vi.fn(),
        onLocate: vi.fn(),
        onGoTo: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
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
