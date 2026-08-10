import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile, ProfileSettings } from '$entities/profile';
import ProfileSwitcher from './ProfileSwitcher.svelte';

const settings = {} as ProfileSettings;
const coastal: Profile = { id: 'p1', name: 'Coastal day', settings, createdAt: 1, updatedAt: 1 };
const night: Profile = { id: 'p2', name: 'Night passage', settings, createdAt: 1, updatedAt: 1 };

const mounted: Array<() => void> = [];

function mountSwitcher(props: Record<string, unknown> = {}): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(ProfileSwitcher, {
      target,
      props: {
        active: coastal,
        profiles: [coastal, night],
        onSelect: vi.fn(),
        onManage: vi.fn(),
        ...props,
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  return target;
}

function trigger(target: HTMLElement): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
  if (!button) throw new Error('no menu trigger');
  return button;
}

function openMenu(target: HTMLElement): void {
  trigger(target).click();
  flushSync();
}

function menuRows(target: HTMLElement): HTMLButtonElement[] {
  return [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('ProfileSwitcher menu', () => {
  it('opens one row per profile plus Manage profiles, marking the active row', () => {
    const target = mountSwitcher();
    openMenu(target);

    const rows = menuRows(target);
    expect(rows.map((row) => row.textContent?.trim())).toEqual([
      'Coastal day',
      'Night passage',
      'Manage profiles',
    ]);
    expect(rows[0]?.getAttribute('aria-current')).toBe('true');
    expect(rows[1]?.getAttribute('aria-current')).toBeNull();
    expect(trigger(target).getAttribute('aria-expanded')).toBe('true');
  });

  it('selecting a profile applies it and closes the menu', () => {
    const onSelect = vi.fn();
    const target = mountSwitcher({ onSelect });
    openMenu(target);

    menuRows(target)[1]?.click();
    flushSync();

    expect(onSelect).toHaveBeenCalledWith('p2');
    expect(trigger(target).getAttribute('aria-expanded')).toBe('false');
  });

  it('Manage profiles opens the panel and closes the menu', () => {
    const onManage = vi.fn();
    const target = mountSwitcher({ onManage });
    openMenu(target);

    menuRows(target).at(-1)?.click();
    flushSync();

    expect(onManage).toHaveBeenCalledOnce();
    expect(trigger(target).getAttribute('aria-expanded')).toBe('false');
  });
});
