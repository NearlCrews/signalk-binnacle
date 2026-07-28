import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { CourseGuidance } from '$entities/course';
import { OwnVessel } from '$entities/vessel';
import { SignalKStore } from '$shared/signalk';
import { createFrameFactory } from '$shared/testing';
import NavStrip from './NavStrip.svelte';

function activeGuidance(): CourseGuidance {
  const store = new SignalKStore();
  store.applyFrame(
    createFrameFactory()({
      'navigation.position': { latitude: 42, longitude: -83 },
      'navigation.course.nextPoint': {
        position: { latitude: 43, longitude: -82 },
        name: 'Harbor entrance',
      },
    }),
  );
  return new CourseGuidance(store, new OwnVessel(store));
}

function renderStrip(): string {
  return render(NavStrip, {
    props: { guidance: activeGuidance(), onStop: vi.fn() },
  }).body;
}

describe('NavStrip', () => {
  it('starts the stop control unarmed and labels it by its visible text', () => {
    const body = renderStrip();
    expect(body).toMatch(/<button[^>]*class="ack"[^>]*>\s*Stop\s*<\/button>/);
    expect(body).not.toContain('Confirm stop?');
    // A fixed aria-label would keep saying "Stop navigation" while the visible text reads
    // "Confirm stop?", which contradicts the label-in-name rule.
    expect(body).not.toContain('aria-label="Stop navigation"');
  });
});
