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

function renderStrip(xteAlarming = false): string {
  return render(NavStrip, {
    props: { guidance: activeGuidance(), units: 'metric', xteAlarming, onStop: vi.fn() },
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

  it('gives the cross-track readout the alarm treatment only while the monitor alarms', () => {
    expect(renderStrip()).not.toContain('sev-danger');
    const alarming = renderStrip(true);
    expect(alarming).toContain('sev-danger');
    // The hover gloss says why the readout turned, not just that it did.
    expect(alarming).toContain('past the off-course alarm limit');
  });

  it('offers the course-settings popover only when a settings write is wired', () => {
    expect(renderStrip()).not.toContain('Course settings');
    const withSettings = render(NavStrip, {
      props: {
        guidance: activeGuidance(),
        units: 'metric' as const,
        onStop: vi.fn(),
        onSetArrivalCircle: vi.fn(),
        onRestartCourse: vi.fn(),
        onSetTargetArrivalTime: vi.fn(),
      },
    }).body;
    expect(withSettings).toContain('aria-label="Course settings"');
    // Closed until tapped: the popover content mounts on open, so the strip stays light.
    expect(withSettings).not.toContain('Arrival radius');
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
