import { createRetryableLazyUiLoader } from '$shared/lib';

export { default as AlarmStrip } from './AlarmStrip.svelte';
export { CollisionMute } from './collision-mute.svelte';
export type { SkNotification } from './collision-notification';
export { CollisionNotifier, NOTIFICATION_PATH } from './collision-notification';
export { COLLISION_OVERLAY_ID, createCollisionOverlay } from './collision-overlay';
export { default as DangerStrip } from './DangerStrip.svelte';
export { GenericAlarm, selectGenericAlarms } from './generic-alarm.svelte';
export { LookoutAlarm } from './lookout-alarm';
export {
  isRaisedNotification,
  notificationGrade,
  notificationLabel,
  worstRaisedNotification,
} from './notification-actions';
export { isShallowAlarmActive, SHALLOW_TONE } from './shallow-alarm';
export type {
  ShallowMonitorSnapshot,
  ShallowMonitorState,
  ShallowThresholdSource,
} from './shallow-monitor.svelte';
export { createShallowController } from './shallow-monitor.svelte';

const alarmsPanelLoader = createRetryableLazyUiLoader(() => import('./AlarmsPanel.svelte'), {
  timeoutMessage: 'Alarms controls took too long to load.',
});

export function loadAlarmsPanel(): Promise<typeof import('./AlarmsPanel.svelte')> {
  return alarmsPanelLoader();
}
