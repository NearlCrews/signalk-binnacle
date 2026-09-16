import type { LatLon } from '$shared/geo';
import { formatLatitude, formatLongitude } from '$shared/lib';

export interface MobNotificationValue {
  state: 'emergency' | 'normal';
  method: string[];
  message: string;
  // Not in the notification schema proper, but carried so other clients can mark the spot.
  position?: LatLon;
  createdAt?: string;
}

export function mobNotification(position?: LatLon, epochMs?: number): MobNotificationValue {
  return {
    state: 'emergency',
    method: ['visual', 'sound'],
    message: position
      ? `Man overboard at ${formatLatitude(position.latitude)} ${formatLongitude(position.longitude)}`
      : 'Man overboard, no position fix',
    ...(position
      ? { position: { latitude: position.latitude, longitude: position.longitude } }
      : {}),
    ...(epochMs !== undefined ? { createdAt: new Date(epochMs).toISOString() } : {}),
  };
}

export function mobClearNotification(): MobNotificationValue {
  return { state: 'normal', method: [], message: 'Man overboard cleared' };
}
