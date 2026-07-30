import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
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
});

describe('IconPicker identity', () => {
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
