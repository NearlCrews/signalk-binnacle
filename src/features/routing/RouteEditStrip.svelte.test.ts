import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { Route } from '$entities/route';
import RouteEditStrip from './RouteEditStrip.svelte';

function strip(waypointCount: number, editorOpen = false, canSave = waypointCount >= 2): string {
  const working = {
    id: 'draft',
    name: 'Draft',
    waypoints: Array.from({ length: waypointCount }, (_, index) => ({
      position: { latitude: index, longitude: index },
    })),
  } as unknown as Route;
  return render(RouteEditStrip, {
    props: {
      working,
      editorOpen,
      onOpenEditor: vi.fn(),
      onSave: vi.fn(),
      canSave,
      onCancel: vi.fn(),
    },
  }).body;
}

describe('RouteEditStrip', () => {
  it('names the mode, the point count, and the next step', () => {
    const empty = strip(0);
    expect(empty).toContain('Editing route');
    expect(empty).toContain('0 points');
    expect(empty).toContain('place the first point');
    const several = strip(3);
    expect(several).toContain('3 points');
    expect(several).toContain('add the next point');
  });

  it('offers the way back to the editor only while the panel is elsewhere', () => {
    expect(strip(1, false)).toContain('Open editor');
    expect(strip(1, true)).not.toContain('Open editor');
  });

  it('disables Save below two points and keeps Cancel armed, not instant', () => {
    const one = strip(1);
    expect(one).toMatch(/disabled[^>]*>[^<]*Save/);
    expect(one).toContain('Cancel');
    expect(one).not.toContain('Confirm cancel?');
    const two = strip(2);
    expect(two).not.toMatch(/disabled[^>]*>[^<]*Save/);
  });
});
