import type { ZoneState } from '$shared/signalk';
import type { TileReading } from './tile-catalog';

export function tileAccessibleLabel(
  label: string,
  reading: TileReading,
  zone: ZoneState,
  sensorGloss: string,
): string {
  const value =
    reading.state === 'never'
      ? sensorGloss
      : `${reading.value}${reading.unit ? ` ${reading.unit}` : ''}${
          reading.secondary ? `, ${reading.secondary}` : ''
        }`;
  const state = reading.state === 'stale' ? ', stale' : '';
  const alert = zone === 'alarm' ? ', alarm' : zone === 'warning' ? ', warning' : '';
  return `${label}, ${value}${state}${alert}. Open details`;
}
