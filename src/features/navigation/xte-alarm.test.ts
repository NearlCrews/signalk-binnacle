import { describe, expect, it } from 'vitest';
import type { ActiveNotification } from '$entities/notifications';
import { DEFAULT_XTE_LIMIT_METERS, isServerXteAlarm, isXteBreach } from './xte-alarm';

const notification = (overrides: Partial<ActiveNotification>): ActiveNotification => ({
  path: 'notifications.navigation.course.calcValues.crossTrackError',
  state: 'alarm',
  message: 'Vessel is off track.',
  activation: 1,
  ...overrides,
});

describe('isXteBreach', () => {
  it('fires only on a fresh error past the limit, on either side of the track', () => {
    expect(isXteBreach(120, false, DEFAULT_XTE_LIMIT_METERS)).toBe(true);
    expect(isXteBreach(-120, false, DEFAULT_XTE_LIMIT_METERS)).toBe(true);
    expect(isXteBreach(89, false, DEFAULT_XTE_LIMIT_METERS)).toBe(false);
    expect(isXteBreach(undefined, false, DEFAULT_XTE_LIMIT_METERS)).toBe(false);
    expect(isXteBreach(120, true, DEFAULT_XTE_LIMIT_METERS)).toBe(false);
  });
});

describe('isServerXteAlarm', () => {
  it('matches an alarm on any cross-track path a producer might use', () => {
    for (const path of [
      'notifications.navigation.course.calcValues.crossTrackError',
      'notifications.navigation.courseGreatCircle.crossTrackError',
      'notifications.navigation.courseRhumbline.crossTrackError',
      'notifications.navigation.course.xte',
    ]) {
      expect(isServerXteAlarm(notification({ path }))).toBe(true);
    }
  });

  it('matches the emergency grade and ignores the grades the generic surface keeps visual', () => {
    expect(isServerXteAlarm(notification({ state: 'emergency' }))).toBe(true);
    expect(isServerXteAlarm(notification({ state: 'warn' }))).toBe(false);
    expect(isServerXteAlarm(notification({ state: 'alert' }))).toBe(false);
  });

  it('still counts a silenced or acknowledged alarm, so the crew decision on it holds', () => {
    expect(isServerXteAlarm(notification({ silenced: true }))).toBe(true);
    expect(isServerXteAlarm(notification({ acknowledged: true }))).toBe(true);
  });

  it("never claims the course-provider's own arrival and perpendicular notifications", () => {
    for (const path of [
      'notifications.navigation.course.arrivalCircleEntered',
      'notifications.navigation.course.perpendicularPassed',
    ]) {
      expect(isServerXteAlarm(notification({ path, state: 'alarm' }))).toBe(false);
    }
  });

  it('requires the navigation subtree, so an unrelated cross-track path stays generic', () => {
    expect(isServerXteAlarm(notification({ path: 'notifications.custom.crossTrackError' }))).toBe(
      false,
    );
    // A bare-prefix look-alike is not the navigation subtree.
    expect(
      isServerXteAlarm(notification({ path: 'notifications.navigationx.crossTrackError' })),
    ).toBe(false);
  });
});
