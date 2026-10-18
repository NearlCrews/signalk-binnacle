import type { RadarHelmHealth } from '$features/marine-radar';
import type { CompanionState } from '$features/prewarm';
import { type AlarmAudioState, alarmAudioNote } from '$shared/audio';
import { chartLockerSummary } from './chart-locker-status';

// Every problem the status bar reports that is not one readout's own, worst first. The Status cell
// shows the first one's word and counts the rest; its list shows them all with their actions.

// The order within a tone. A collision mute and a silenced alarm lead the cautions, because each
// one hides a safety signal rather than reporting a missing reading.
export const NOTICE_ORDER = [
  'link',
  'offline',
  'collision-mute',
  'sound',
  'fix',
  'depth',
  'alerts',
  'ais',
  'weather',
  'radar',
  'orientation',
  'charts',
  'update',
] as const;
type NoticeId = (typeof NOTICE_ORDER)[number];

// Alarm is red (the data or the internet has stopped), warning is amber, and info is a plain
// accent: news, never a caution.
type NoticeTone = 'alarm' | 'warning' | 'info';
const TONE_RANK: Record<NoticeTone, number> = { alarm: 0, warning: 1, info: 2 };

type NoticeAction =
  | { kind: 'button'; label: string; run: () => void }
  | { kind: 'link'; label: string; href: string };

export interface StatusNotice {
  id: NoticeId;
  tone: NoticeTone;
  icon: 'alert' | 'mute' | 'info';
  // The Status cell's word: short enough for the narrowest bar column.
  word: string;
  // The list row's full title, and the line that explains it.
  title: string;
  detail?: string;
  action?: NoticeAction;
  // Announced politely when it newly appears.
  live?: boolean;
  // A consequence of the data link itself failing, dimmed under that one failure.
  subordinate?: boolean;
}

export function sortNotices(notices: readonly StatusNotice[]): StatusNotice[] {
  return [...notices].sort(
    (a, b) =>
      TONE_RANK[a.tone] - TONE_RANK[b.tone] ||
      NOTICE_ORDER.indexOf(a.id) - NOTICE_ORDER.indexOf(b.id),
  );
}

export interface StatusNoticeInput {
  streamError: boolean;
  connectionDown: boolean;
  dataStalled: boolean;
  // The short connection label and its fuller diagnosis.
  connectionLabel: string;
  connectionTitle: string;
  online: boolean;
  fixStale: boolean;
  gpsNeverReceived: boolean;
  linkDown: boolean;
  // The shallow watch was watching and has stopped (stale or unusable depth), with the reason.
  depthPaused: boolean;
  depthTitle?: string;
  collisionMuteMinutes?: number;
  soundOff?: AlarmAudioState;
  alertCount: number;
  weatherWarning?: string;
  radarHealth: RadarHelmHealth;
  lookoutOpen: boolean;
  aisUnassessed: number;
  aisTitle: string;
  orientation?: { label: string; active: boolean };
  chartLocker?: { state: CompanionState; accessUrl: string };
  updateReady: boolean;
  onReconnect?: () => void;
  onOpenHelp?: () => void;
  onUnmuteCollision?: () => void;
  onEnableSound?: () => void;
  onRetrySound?: () => void;
  onOpenAlarms?: () => void;
  onOpenWeather?: () => void;
  onOpenRadar?: () => void;
  onOpenAis?: () => void;
  onResetOrientation?: () => void;
  onRetryChartLocker?: () => void;
  onOpenOfflineCharts?: () => void;
  onReload?: () => void;
}

// A weather headline short enough for the cell names itself; a longer one says Weather.
const WEATHER_WORD_MAX = 8;

function button(label: string, run: (() => void) | undefined): NoticeAction | undefined {
  return run ? { kind: 'button', label, run } : undefined;
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

export function buildStatusNotices(input: StatusNoticeInput): StatusNotice[] {
  const notices: StatusNotice[] = [];
  const add = (notice: StatusNotice): void => {
    notices.push(notice);
  };

  if (input.streamError) {
    add({
      id: 'link',
      tone: 'alarm',
      icon: 'alert',
      word: 'Link error',
      title: 'Data link failed',
      detail: 'The Signal K data link failed. Readouts pause until it is back.',
      action: button('Retry', input.onReconnect),
    });
  } else if (input.connectionDown || input.dataStalled) {
    add({
      id: 'link',
      tone: 'alarm',
      icon: 'alert',
      word: input.connectionDown ? 'No link' : 'No data',
      title: input.connectionLabel,
      detail: input.connectionTitle,
      action: button('Reconnect', input.onReconnect),
    });
  }
  if (!input.online) {
    add({
      id: 'offline',
      tone: 'alarm',
      icon: 'alert',
      word: 'Offline',
      title: 'Offline',
      detail: 'This device has no network connection. Charts already cached still show.',
      live: true,
    });
  }
  if (input.collisionMuteMinutes !== undefined) {
    const minutes = input.collisionMuteMinutes;
    add({
      id: 'collision-mute',
      tone: 'warning',
      icon: 'mute',
      word: 'Muted',
      title: `Collision alarm muted, ${plural(minutes, 'minute')} left`,
      detail: 'The collision alarm stays silent until then, unless a contact becomes imminent.',
      action: button('Unmute', input.onUnmuteCollision),
    });
  }
  if (input.soundOff === 'blocked') {
    add({
      id: 'sound',
      tone: 'warning',
      icon: 'mute',
      word: 'Sound off',
      title: 'Alarm sound off',
      detail: alarmAudioNote('blocked'),
      action: button('Enable', input.onEnableSound),
    });
  } else if (input.soundOff === 'failed') {
    add({
      id: 'sound',
      tone: 'warning',
      icon: 'mute',
      word: 'No sound',
      title: 'Alarm sound failed',
      detail: alarmAudioNote('failed'),
      action: button('Try again', input.onRetrySound),
    });
  } else if (input.soundOff === 'unsupported') {
    add({
      id: 'sound',
      tone: 'warning',
      icon: 'mute',
      word: 'No sound',
      title: 'Alarm sound unavailable',
      detail: alarmAudioNote('unsupported'),
    });
  }
  if (input.fixStale) {
    add({
      id: 'fix',
      tone: 'warning',
      icon: 'alert',
      word: 'GPS lost',
      title: 'No GPS fix',
      detail: 'Position, course, and speed are on hold until a fix returns.',
      live: true,
      subordinate: input.linkDown,
    });
  } else if (input.gpsNeverReceived) {
    add({
      id: 'fix',
      tone: 'warning',
      icon: 'alert',
      word: 'No GPS',
      title: 'Waiting for GPS',
      detail:
        "Connected, but the server has not published a GPS position. Check the GPS source in the Signal K server's Data Browser, or open Help.",
      action: button('Help', input.onOpenHelp),
      live: true,
    });
  }
  if (input.depthPaused) {
    add({
      id: 'depth',
      tone: 'warning',
      icon: 'alert',
      word: 'No depth',
      title: 'Shallow watch paused',
      detail: input.depthTitle,
      subordinate: input.linkDown,
    });
  }
  if (input.alertCount > 0) {
    const alerts = plural(input.alertCount, 'alert');
    add({
      id: 'alerts',
      tone: 'warning',
      icon: 'alert',
      word: alerts,
      title: alerts,
      detail: 'Raised by the Signal K server below the alarm level.',
      action: button('Open Alarms', input.onOpenAlarms),
    });
  }
  if (input.lookoutOpen && input.aisUnassessed > 0) {
    add({
      id: 'ais',
      tone: 'warning',
      icon: 'alert',
      word: 'AIS gaps',
      title: `${plural(input.aisUnassessed, 'AIS target')} unassessed`,
      detail: input.aisTitle,
      action: button('Open AIS', input.onOpenAis),
      subordinate: input.linkDown,
    });
  }
  if (input.weatherWarning) {
    const warning = input.weatherWarning;
    add({
      id: 'weather',
      tone: 'warning',
      icon: 'alert',
      word: warning.length <= WEATHER_WORD_MAX ? warning : 'Weather',
      title: `Weather warning: ${warning}`,
      detail: 'Issued by a weather provider for this position.',
      action: button('Open forecast', input.onOpenWeather),
    });
  }
  if (input.radarHealth.state !== 'quiet') {
    const health = input.radarHealth;
    const failed = health.state === 'failed';
    const renderer = health.state === 'failed' && health.reason === 'renderer';
    add({
      id: 'radar',
      tone: failed ? 'alarm' : 'warning',
      icon: 'alert',
      word: failed ? 'No radar' : 'Radar',
      title: failed ? (renderer ? 'Radar display failed' : 'Radar stream failed') : 'Radar stale',
      detail: failed
        ? renderer
          ? 'Radar is transmitting but the echo display failed on this device.'
          : 'Radar is transmitting but its data stream failed.'
        : 'Radar is transmitting but no fresh echo frames are arriving.',
      action: button('Open radar', input.onOpenRadar),
      live: true,
    });
  }
  if (input.orientation && !input.orientation.active) {
    add({
      id: 'orientation',
      tone: 'warning',
      icon: 'alert',
      word: 'North up',
      title: input.orientation.label,
      detail: 'The chosen rotation resumes when its data returns.',
      action: button('Use north up', input.onResetOrientation),
    });
  }
  if (input.chartLocker) {
    const { state, accessUrl } = input.chartLocker;
    const summary = chartLockerSummary(state, null);
    if (summary.problem) {
      add({
        id: 'charts',
        tone: summary.signIn ? 'info' : 'warning',
        icon: summary.signIn ? 'info' : 'alert',
        word: summary.signIn ? 'Sign in' : 'Charts',
        title: summary.title,
        action: summary.signIn
          ? { kind: 'link', label: 'Sign in', href: accessUrl }
          : state === 'access-error'
            ? button('Retry', input.onRetryChartLocker)
            : button('Open offline charts', input.onOpenOfflineCharts),
      });
    }
  }
  if (input.updateReady) {
    add({
      id: 'update',
      tone: 'info',
      icon: 'info',
      word: 'Update',
      title: 'Update ready',
      detail: 'A new version of Binnacle is ready. Reload to start it.',
      action: button('Reload', input.onReload),
    });
  }
  return sortNotices(notices);
}
