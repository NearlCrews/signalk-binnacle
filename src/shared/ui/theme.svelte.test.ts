import { describe, expect, it } from 'vitest';
import { nightToggleTarget, ThemeController } from './theme.svelte';

describe('ThemeController', () => {
  it('defaults to day', () => {
    const c = new ThemeController(null, () => {});
    expect(c.theme).toBe('day');
  });

  it('restores a persisted theme', () => {
    const c = new ThemeController('night-red', () => {});
    expect(c.theme).toBe('night-red');
  });

  it('ignores an invalid persisted value', () => {
    const c = new ThemeController('bogus', () => {});
    expect(c.theme).toBe('day');
  });

  it('applies the initial theme on construction', () => {
    const applied: string[] = [];
    const c = new ThemeController('dusk', (t) => applied.push(t));
    expect(c.theme).toBe('dusk');
    expect(applied).toEqual(['dusk']);
  });

  it('set writes through the apply callback and persists', () => {
    const applied: string[] = [];
    const saved: string[] = [];
    const c = new ThemeController(
      null,
      (t) => applied.push(t),
      (t) => saved.push(t),
    );
    c.set('dusk');
    expect(c.theme).toBe('dusk');
    expect(applied).toContain('dusk');
    expect(saved).toContain('dusk');
  });
});

describe('nightToggleTarget', () => {
  it('goes straight to night from day or dusk, never through dusk', () => {
    expect(nightToggleTarget('day', 'day')).toBe('night-red');
    expect(nightToggleTarget('dusk', 'dusk')).toBe('night-red');
  });

  it('returns to the theme it left, and to day only when nothing lighter is remembered', () => {
    expect(nightToggleTarget('night-red', 'dusk')).toBe('dusk');
    expect(nightToggleTarget('night-red', 'day')).toBe('day');
    expect(nightToggleTarget('night-red', 'night-red')).toBe('day');
  });
});
