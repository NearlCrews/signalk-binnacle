import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SymbolsStore } from '$entities/symbols';
import type { SkSymbol } from '$shared/signalk';
import IconPicker from './IconPicker.svelte';

const mounted: Array<() => void> = [];

function symbol(uuid: string, name: string, aliases: string[]): SkSymbol {
  return {
    uuid,
    aliases,
    name,
    url: `/signalk/symbol-manager/symbols/${uuid}.svg`,
    roles: ['note'],
  };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
  vi.restoreAllMocks();
});

function mountScrollablePicker(value: string) {
  const dialog = document.createElement('dialog');
  const scroller = document.createElement('div');
  scroller.style.cssText = 'width: 260px; height: 100px; overflow: auto;';
  const spacer = document.createElement('div');
  spacer.style.height = '160px';
  const target = document.createElement('div');
  const styles = document.createElement('style');
  styles.textContent = '.picker-list { max-height: 120px; } .picker-option { min-height: 44px; }';
  scroller.append(spacer, target);
  dialog.append(scroller, styles);
  document.body.append(dialog);
  dialog.showModal();
  const symbols = new SymbolsStore('http://pi', undefined, [
    symbol('late', 'Late custom symbol', ['custom:late']),
  ]);
  const component = flushSync(() =>
    mount(IconPicker, {
      target,
      props: {
        value,
        symbols,
        symbolRole: 'note',
        defaultOption: { iconId: 'note', label: 'Use category marker', fallbackSvg: '' },
      },
    }),
  );
  mounted.push(() => {
    void unmount(component);
    dialog.close();
    dialog.remove();
  });
  const trigger = target.querySelector<HTMLButtonElement>('.picker-trigger');
  if (!trigger) throw new Error('Missing icon trigger');
  trigger.scrollIntoView({ block: 'nearest' });
  const scrollTop = scroller.scrollTop;
  return { target, trigger, scroller, scrollTop };
}

describe('IconPicker identity', () => {
  it.each(['', 'custom:late'])(
    'focuses selected value %s without scrolling the editor',
    async (value) => {
      const test = mountScrollablePicker(value);
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      test.trigger.click();
      flushSync();
      const selected = test.target.querySelector<HTMLButtonElement>(
        '[role="option"][aria-selected="true"]',
      );
      const surface = test.target.querySelector<HTMLElement>('[role="listbox"]');
      if (!selected || !surface) throw new Error('Missing icon choices');
      await vi.waitFor(() => expect(document.activeElement).toBe(selected));
      const selectedFocusCall = focus.mock.contexts.indexOf(selected);
      expect(selectedFocusCall).toBeGreaterThanOrEqual(0);
      expect(focus.mock.calls[selectedFocusCall]).toEqual([{ preventScroll: true }]);
      expect(test.scroller.scrollTop).toBe(test.scrollTop);
      expect(selected.offsetTop).toBeGreaterThanOrEqual(surface.scrollTop);
      expect(selected.offsetTop + selected.offsetHeight).toBeLessThanOrEqual(
        surface.scrollTop + surface.clientHeight,
      );
      if (value) expect(surface.scrollTop).toBeGreaterThan(0);

      selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      expect(document.activeElement).toBe(surface.querySelector('[role="option"]'));
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      );
      expect(document.activeElement).toBe(surface.querySelector('[role="option"]:last-child'));
    },
  );

  it('mounts conflicting aliases as distinct selectable values', () => {
    const symbols = new SymbolsStore('http://pi', undefined, [
      symbol('first', 'First symbol', ['custom:shared']),
      symbol('alternate', 'Alternate symbol', ['custom:shared', 'binnacle:alternate']),
      symbol('shadowed', 'Shadowed symbol', ['custom:shared']),
    ]);
    const target = document.createElement('div');
    document.body.append(target);
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(IconPicker, {
        target,
        props: {
          value: 'custom:shared',
          symbols,
          symbolRole: 'note',
        },
      });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });

    target.querySelector<HTMLButtonElement>('.picker-trigger')?.click();
    flushSync();
    const options = [...target.querySelectorAll<HTMLButtonElement>('[role="option"]')];

    expect(options.filter((option) => option.textContent?.includes('First symbol'))).toHaveLength(
      1,
    );
    expect(
      options.filter((option) => option.textContent?.includes('Alternate symbol')),
    ).toHaveLength(1);
    expect(target.textContent).not.toContain('Shadowed symbol');

    options.find((option) => option.textContent?.includes('Alternate symbol'))?.click();
    flushSync();
    expect(target.querySelector('.picker-label')?.textContent).toBe('Alternate symbol');
  });
});
