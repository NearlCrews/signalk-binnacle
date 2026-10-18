import { describe, expect, it, vi } from 'vitest';
import {
  buildStatusNotices,
  NOTICE_ORDER,
  type StatusNotice,
  type StatusNoticeInput,
  sortNotices,
} from './status-notices';

function calm(overrides: Partial<StatusNoticeInput> = {}): StatusNoticeInput {
  return {
    streamError: false,
    connecting: false,
    connectionDown: false,
    dataStalled: false,
    connectionLabel: 'Connected',
    connectionTitle: 'Connected to the Signal K server.',
    online: true,
    fixStale: false,
    gpsNeverReceived: false,
    linkDown: false,
    depthPaused: false,
    alertCount: 0,
    radarHealth: { state: 'quiet' },
    lookoutOpen: true,
    aisUnassessed: 0,
    aisTitle: 'AIS targets being watched for collision risk',
    updateReady: false,
    ...overrides,
  };
}

function only(overrides: Partial<StatusNoticeInput>): StatusNotice {
  const notices = buildStatusNotices(calm(overrides));
  expect(notices).toHaveLength(1);
  const [notice] = notices;
  if (!notice) throw new Error('no notice');
  return notice;
}

function actionLabel(notice: StatusNotice): string | undefined {
  return notice.action?.label;
}

describe('buildStatusNotices', () => {
  it('reports nothing while nothing is wrong', () => {
    expect(buildStatusNotices(calm())).toEqual([]);
    expect(buildStatusNotices(calm({ soundOff: 'ready' }))).toEqual([]);
  });

  it('names a failed data link in red with a retry', () => {
    const onReconnect = vi.fn();
    const notice = only({ streamError: true, onReconnect });
    expect(notice).toMatchObject({ id: 'link', tone: 'alarm', word: 'Link error' });
    expect(notice.title).toBe('Data link failed');
    expect(actionLabel(notice)).toBe('Retry');
    if (notice.action?.kind === 'button') notice.action.run();
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it('names a dropped and a silent link with the connection label and a reconnect', () => {
    const down = only({
      connectionDown: true,
      connectionLabel: 'Reconnecting',
      onReconnect: () => {},
    });
    expect(down).toMatchObject({ word: 'No link', title: 'Reconnecting', tone: 'alarm' });
    expect(down.detail).toBe('Connected to the Signal K server.');
    expect(actionLabel(down)).toBe('Reconnect');
    const stalled = only({ dataStalled: true, connectionLabel: 'Connected, no data' });
    expect(stalled).toMatchObject({ word: 'No data', title: 'Connected, no data' });
  });

  it('never reads calm while the first connection is still being made', () => {
    expect(only({ connecting: true, connectionLabel: 'Connecting' })).toMatchObject({
      id: 'link',
      tone: 'info',
      word: 'No link',
      title: 'Connecting',
    });
  });

  it('says offline in red and announces it', () => {
    expect(only({ online: false })).toMatchObject({
      id: 'offline',
      word: 'Offline',
      tone: 'alarm',
      live: true,
    });
  });

  it('tells a lost fix from GPS that never arrived', () => {
    expect(only({ fixStale: true })).toMatchObject({
      word: 'GPS lost',
      title: 'No GPS fix',
      tone: 'warning',
      live: true,
      subordinate: false,
    });
    expect(only({ fixStale: true, linkDown: true }).subordinate).toBe(true);
    const waiting = only({ gpsNeverReceived: true });
    expect(waiting).toMatchObject({ word: 'No GPS', title: 'Waiting for GPS', live: true });
    expect(waiting.action).toBeUndefined();
    expect(actionLabel(only({ gpsNeverReceived: true, onOpenHelp: () => {} }))).toBe('Help');
  });

  it('counts down a collision mute and offers to unmute', () => {
    const notice = only({ collisionMuteMinutes: 9, onUnmuteCollision: () => {} });
    expect(notice).toMatchObject({ word: 'Muted', icon: 'mute', tone: 'warning' });
    expect(notice.title).toBe('Collision alarm muted, 9 minutes left');
    expect(actionLabel(notice)).toBe('Unmute');
    expect(only({ collisionMuteMinutes: 1 }).title).toBe('Collision alarm muted, 1 minute left');
  });

  it('offers only the alarm sound action that can work', () => {
    const blocked = only({ soundOff: 'blocked', onEnableSound: () => {} });
    expect(blocked).toMatchObject({ word: 'Sound off', title: 'Alarm sound off', icon: 'mute' });
    expect(actionLabel(blocked)).toBe('Enable');
    const failed = only({ soundOff: 'failed', onRetrySound: () => {} });
    expect(failed).toMatchObject({ word: 'No sound', title: 'Alarm sound failed' });
    expect(actionLabel(failed)).toBe('Try again');
    const unsupported = only({ soundOff: 'unsupported' });
    expect(unsupported).toMatchObject({ word: 'No sound', title: 'Alarm sound unavailable' });
    expect(unsupported.action).toBeUndefined();
    expect(unsupported.detail).toBeTruthy();
  });

  it('reports a paused shallow watch with its reason', () => {
    expect(only({ depthPaused: true, depthTitle: 'Depth data is stale' })).toMatchObject({
      id: 'depth',
      word: 'No depth',
      title: 'Shallow watch paused',
      detail: 'Depth data is stale',
    });
  });

  it('counts alerts in words and opens Alarms', () => {
    expect(only({ alertCount: 1, onOpenAlarms: () => {} })).toMatchObject({
      word: '1 alert',
      title: '1 alert',
      action: { label: 'Open Alarms' },
    });
    expect(only({ alertCount: 3 }).word).toBe('3 alerts');
  });

  it('reports unassessed AIS targets only while the lookout is connected', () => {
    expect(only({ aisUnassessed: 2 })).toMatchObject({
      word: 'AIS gaps',
      title: '2 AIS targets unassessed',
    });
    expect(only({ aisUnassessed: 1 }).title).toBe('1 AIS target unassessed');
    expect(buildStatusNotices(calm({ aisUnassessed: 2, lookoutOpen: false }))).toEqual([]);
  });

  it('names a short weather headline and shortens a long one', () => {
    expect(only({ weatherWarning: 'Gale', onOpenWeather: () => {} })).toMatchObject({
      word: 'Gale',
      title: 'Weather warning: Gale',
      action: { label: 'Open forecast' },
    });
    expect(only({ weatherWarning: 'Small Craft Advisory' }).word).toBe('Weather');
  });

  it('grades radar trouble: stale in amber, failed in red', () => {
    expect(only({ radarHealth: { state: 'stale' } })).toMatchObject({
      word: 'Radar',
      tone: 'warning',
      title: 'Radar stale',
    });
    expect(only({ radarHealth: { state: 'failed', reason: 'stream' } })).toMatchObject({
      word: 'No radar',
      tone: 'alarm',
      title: 'Radar stream failed',
    });
    expect(only({ radarHealth: { state: 'failed', reason: 'renderer' } }).title).toBe(
      'Radar display failed',
    );
  });

  it('explains a fallen-back rotation and offers north up', () => {
    const notice = only({
      orientation: { label: 'Course up, no course: north up', active: false },
      onResetOrientation: () => {},
    });
    expect(notice).toMatchObject({ word: 'North up', title: 'Course up, no course: north up' });
    expect(actionLabel(notice)).toBe('Use north up');
    expect(buildStatusNotices(calm({ orientation: { label: 'Course up', active: true } }))).toEqual(
      [],
    );
  });

  it('asks for a Chart Locker sign-in quietly and cautions on real trouble', () => {
    const accessUrl = '/admin/#/login';
    for (const state of ['needs-login', 'needs-admin'] as const) {
      const notice = only({ chartLocker: { state, accessUrl } });
      expect(notice).toMatchObject({ word: 'Sign in', tone: 'info' });
      expect(notice.action).toEqual({ kind: 'link', label: 'Sign in', href: accessUrl });
    }
    expect(
      actionLabel(
        only({ chartLocker: { state: 'access-error', accessUrl }, onRetryChartLocker: () => {} }),
      ),
    ).toBe('Retry');
    for (const state of ['offline', 'error'] as const) {
      const notice = only({ chartLocker: { state, accessUrl }, onOpenOfflineCharts: () => {} });
      expect(notice).toMatchObject({ word: 'Charts', tone: 'warning' });
      expect(actionLabel(notice)).toBe('Open offline charts');
    }
    for (const state of ['serving', 'checking'] as const) {
      expect(buildStatusNotices(calm({ chartLocker: { state, accessUrl } }))).toEqual([]);
    }
  });

  it('offers a ready update as news, not a caution', () => {
    expect(only({ updateReady: true, onReload: () => {} })).toMatchObject({
      word: 'Update',
      tone: 'info',
      action: { label: 'Reload' },
    });
  });

  it('marks the panel doors, so the list closes behind them, and not the fixes in place', () => {
    const notices = buildStatusNotices(
      calm({
        alertCount: 1,
        onOpenAlarms: () => {},
        soundOff: 'blocked',
        onEnableSound: () => {},
        weatherWarning: 'Gale',
        onOpenWeather: () => {},
      }),
    );
    const opens = Object.fromEntries(
      notices.map((notice) => [
        notice.id,
        notice.action?.kind === 'button' ? notice.action.opens === true : undefined,
      ]),
    );
    expect(opens).toEqual({ sound: false, alerts: true, weather: true });
  });

  it('puts red before amber before news, then the fixed order', () => {
    const ids = (input: Partial<StatusNoticeInput>) =>
      buildStatusNotices(calm(input)).map((notice) => notice.id);
    expect(ids({ online: false, fixStale: true, soundOff: 'blocked', updateReady: true })).toEqual([
      'offline',
      'sound',
      'fix',
      'update',
    ]);
    expect(ids({ fixStale: true, radarHealth: { state: 'failed', reason: 'stream' } })).toEqual([
      'radar',
      'fix',
    ]);
    expect(ids({ alertCount: 1, radarHealth: { state: 'stale' } })).toEqual(['alerts', 'radar']);
    expect(ids({ fixStale: true, collisionMuteMinutes: 5 })).toEqual(['collision-mute', 'fix']);
  });
});

describe('sortNotices', () => {
  it('orders every notice id the same way the list documents it', () => {
    const notices = [...NOTICE_ORDER]
      .reverse()
      .map((id): StatusNotice => ({ id, tone: 'warning', icon: 'alert', word: id, title: id }));
    expect(sortNotices(notices).map((notice) => notice.id)).toEqual([...NOTICE_ORDER]);
  });
});
