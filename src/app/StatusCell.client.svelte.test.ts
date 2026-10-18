import '@fontsource-variable/inter/wght.css';
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import A11Y_CSS from '../styles/a11y.css?raw';
import BADGES_CSS from '../styles/badges.css?raw';
import BASE_CSS from '../styles/base.css?raw';
import BUTTONS_CSS from '../styles/buttons.css?raw';
import DATA_CELLS_CSS from '../styles/data-cells.css?raw';
import OVERLAYS_CSS from '../styles/overlays.css?raw';
import TOKENS_CSS from '../styles/tokens.css?raw';
import StatusCell from './StatusCell.svelte';
import type { StatusNotice } from './status-notices';

let sheet: HTMLStyleElement;
beforeAll(async () => {
  sheet = document.createElement('style');
  sheet.textContent = [
    TOKENS_CSS,
    BASE_CSS,
    BUTTONS_CSS,
    BADGES_CSS,
    DATA_CELLS_CSS,
    OVERLAYS_CSS,
    A11Y_CSS,
  ].join('\n');
  document.head.append(sheet);
  await page.viewport(1400, 700);
});
afterAll(() => sheet.remove());

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.();
});

function notice(overrides: Partial<StatusNotice> & Pick<StatusNotice, 'id'>): StatusNotice {
  return { tone: 'warning', icon: 'alert', word: overrides.id, title: overrides.id, ...overrides };
}

async function frames(count = 3): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    flushSync();
  }
}

function setup(initial: StatusNotice[], column = '6.9rem') {
  const props = $state({
    notices: initial,
    connectionLabel: 'Connected',
    connectionTitle: 'Connected to the Signal K server.',
    emergency: false,
  });
  const target = document.createElement('div');
  target.style.cssText = `display:grid;grid-template-columns:${column};position:fixed;left:20px;bottom:20px;font-family:var(--font-ui);font-size:var(--text-md);`;
  document.body.append(target);
  const component = mount(StatusCell, { target, props });
  flushSync();
  mounted.push(async () => {
    await unmount(component);
    target.remove();
  });
  const cell = target.querySelector<HTMLButtonElement>('button.status-cell');
  if (!cell) throw new Error('no Status cell');
  return { props, target, cell };
}

function list(): HTMLElement | null {
  return document.getElementById('status-list');
}

async function openList(cell: HTMLButtonElement): Promise<HTMLElement> {
  cell.click();
  flushSync();
  await frames();
  const surface = list();
  if (!surface) throw new Error('the list did not open');
  return surface;
}

describe('StatusCell list', () => {
  it('opens above the cell with one row per problem, worst first, each with its action', async () => {
    const enable = vi.fn();
    const { cell } = setup([
      notice({ id: 'offline', tone: 'alarm', title: 'Offline', detail: 'No network.' }),
      notice({
        id: 'sound',
        icon: 'mute',
        title: 'Alarm sound off',
        detail: 'Tap to enable.',
        action: { kind: 'button', label: 'Enable', run: enable },
      }),
    ]);
    const surface = await openList(cell);
    expect(cell.getAttribute('aria-expanded')).toBe('true');
    expect(surface.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      cell.getBoundingClientRect().top + 1,
    );
    const rows = [...surface.querySelectorAll('.status-row')];
    expect(rows.map((row) => row.querySelector('.status-row-title')?.textContent)).toEqual([
      'Offline',
      'Alarm sound off',
    ]);
    expect(rows[0]?.querySelector('.status-row-detail')?.textContent).toBe('No network.');
    const action = rows[1]?.querySelector<HTMLButtonElement>('.btn');
    expect(action?.textContent).toBe('Enable');
    expect(action?.getAttribute('aria-describedby')).toBe('status-row-sound');
    // The first action takes focus, so a keyboard user lands on something to do.
    expect(document.activeElement).toBe(action);
    action?.click();
    expect(enable).toHaveBeenCalledOnce();
  });

  it('closes on Escape and returns focus to the cell', async () => {
    const { cell } = setup([notice({ id: 'offline', tone: 'alarm' })]);
    const surface = await openList(cell);
    surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    await expect.poll(list).toBeNull();
    expect(document.activeElement).toBe(cell);
  });

  it('shows the connection when opened with nothing wrong', async () => {
    const { cell } = setup([]);
    const surface = await openList(cell);
    expect(surface.textContent).toContain('Connected to the Signal K server.');
    expect(document.activeElement).toBe(surface);
  });

  it('moves focus to the next row when an action clears its own', async () => {
    const { props, cell } = setup([
      notice({ id: 'sound', action: { kind: 'button', label: 'Enable', run: () => {} } }),
      notice({ id: 'fix', action: { kind: 'button', label: 'Help', run: () => {} } }),
    ]);
    await openList(cell);
    props.notices = props.notices.slice(1);
    flushSync();
    await tick();
    expect(document.activeElement?.textContent).toBe('Help');
  });

  it('closes and returns focus to the cell when the last problem clears', async () => {
    const { props, cell } = setup([
      notice({ id: 'sound', action: { kind: 'button', label: 'Enable', run: () => {} } }),
    ]);
    await openList(cell);
    props.notices = [];
    flushSync();
    await expect.poll(list).toBeNull();
    expect(document.activeElement).toBe(cell);
  });

  it('closes behind an action that opens a panel, and stays open on one that fixes in place', async () => {
    const openForecast = vi.fn();
    const enable = vi.fn();
    const { cell } = setup([
      notice({
        id: 'sound',
        action: { kind: 'button', label: 'Enable', run: enable },
      }),
      notice({
        id: 'weather',
        action: { kind: 'button', label: 'Open forecast', run: openForecast, opens: true },
      }),
    ]);
    const surface = await openList(cell);
    surface.querySelector<HTMLButtonElement>('[aria-describedby="status-row-sound"]')?.click();
    flushSync();
    expect(enable).toHaveBeenCalledOnce();
    expect(list()).not.toBeNull();
    surface.querySelector<HTMLButtonElement>('[aria-describedby="status-row-weather"]')?.click();
    flushSync();
    expect(openForecast).toHaveBeenCalledOnce();
    await expect.poll(list).toBeNull();
  });

  it('gets out of the way of a safety alarm', async () => {
    const { props, cell } = setup([notice({ id: 'offline', tone: 'alarm' })]);
    await openList(cell);
    props.emergency = true;
    flushSync();
    await expect.poll(list).toBeNull();
  });
});

describe('StatusCell announcements', () => {
  it('announces each live problem once as it appears, worst or not', async () => {
    const offline = notice({ id: 'offline', tone: 'alarm', title: 'Offline', live: true });
    const fix = notice({ id: 'fix', title: 'No GPS fix', live: true });
    const sound = notice({ id: 'sound', title: 'Alarm sound off' });
    const { props, target } = setup([offline]);
    const region = target.querySelector('.notice-live');
    if (!region) throw new Error('no notice region');
    const said: string[] = [];
    const observer = new MutationObserver(() => {
      const text = region.textContent ?? '';
      if (text) said.push(text);
    });
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    try {
      // Present at mount: not announced.
      await tick();
      expect(said).toEqual([]);
      props.notices = [offline, fix];
      flushSync();
      await tick();
      await tick();
      expect(said).toEqual(['No GPS fix']);
      // A change of order, or a notice that is not live, says nothing new.
      props.notices = [fix, offline, sound];
      flushSync();
      await tick();
      await tick();
      expect(said).toEqual(['No GPS fix']);
      // Gone, then back: announced again.
      props.notices = [offline];
      flushSync();
      await tick();
      props.notices = [offline, fix];
      flushSync();
      await tick();
      await tick();
      expect(said).toEqual(['No GPS fix', 'No GPS fix']);
      // Same id, new words (radar going from stale to failed): announced as the escalation it is.
      props.notices = [offline, { ...fix, title: 'Waiting for GPS' }];
      flushSync();
      await tick();
      await tick();
      expect(said).toEqual(['No GPS fix', 'No GPS fix', 'Waiting for GPS']);
    } finally {
      observer.disconnect();
    }
  });
});

describe('StatusCell words', () => {
  // Every word the notice model can put in the cell, plus the widest a weather headline may be.
  const WORDS = [
    'Link error',
    'No link',
    'No data',
    'Offline',
    'Muted',
    'Sound off',
    'No sound',
    'GPS lost',
    'No GPS',
    'No depth',
    '99 alerts',
    'AIS gaps',
    'Weather',
    'Dense Fo',
    'Tsunami',
    'Radar',
    'No radar',
    'North up',
    'Charts',
    'Sign in',
    'Update',
  ];

  for (const column of ['5.75rem', '6.9rem']) {
    it(`fits every word and the count in a ${column} column without cutting it`, async () => {
      await document.fonts.load('600 16px "Inter Variable"');
      for (const word of WORDS) {
        const { cell } = setup(
          [notice({ id: 'fix', word }), notice({ id: 'alerts' }), notice({ id: 'update' })],
          column,
        );
        const value = cell.querySelector<HTMLElement>('.data-cell-value');
        const shown = cell.querySelector<HTMLElement>('.word');
        const label = cell.querySelector<HTMLElement>('.status-label');
        if (!value || !shown || !label) throw new Error('cell parts missing');
        expect(shown.scrollWidth, word).toBeLessThanOrEqual(shown.clientWidth);
        expect(value.scrollWidth, word).toBeLessThanOrEqual(value.clientWidth);
        expect(label.scrollWidth, word).toBeLessThanOrEqual(label.clientWidth);
        await mounted.pop()?.();
      }
    });
  }
});
