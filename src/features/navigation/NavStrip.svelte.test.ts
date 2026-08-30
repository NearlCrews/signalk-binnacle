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
    props: { guidance: activeGuidance(), units: 'metric', onStop: vi.fn() },
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

  it('glosses every acronym it shows, for a navigator who does not know them', () => {
    const html = renderStrip();
    for (const gloss of [
      'Distance to waypoint',
      'Bearing to waypoint, degrees true',
      'Cross-track error',
      'Velocity made good toward the waypoint',
      'Time to go to the waypoint',
    ]) {
      expect(html).toContain(gloss);
    }
  });
});
