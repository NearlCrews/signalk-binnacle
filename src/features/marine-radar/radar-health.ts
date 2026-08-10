import type { RadarConnectionStatus, RadarRendererStatus } from './marine-radar-store.svelte';
import type { RadarStatus } from './radar-types';

// Helm-visible radar health, distinct from the Radar Controls panel's detailed status: the helm
// only needs to know when a picture it is relying on has quietly stopped. Quiet whenever the echo
// is hidden or the radar is intentionally off or standing by, degraded when transmission is active
// but frames have gone stale, and failed when the stream or the renderer is down while the radar
// transmits. Connection grace (connecting, waiting) stays quiet: reconnect blips are routine, and
// a genuinely interrupted stream grades stale on its own.
export type RadarHelmHealth =
  | { state: 'quiet' }
  | { state: 'stale' }
  | { state: 'failed'; reason: 'stream' | 'renderer' };

const QUIET: RadarHelmHealth = { state: 'quiet' };

export function radarHelmHealth(input: {
  echoShown: boolean;
  operationalStatus: RadarStatus | undefined;
  connection: RadarConnectionStatus;
  renderer: RadarRendererStatus;
}): RadarHelmHealth {
  if (!input.echoShown) return QUIET;
  const transmitting =
    input.operationalStatus === 'transmit' || input.operationalStatus === 'warming';
  if (!transmitting) return QUIET;
  if (
    input.renderer === 'error' ||
    input.renderer === 'context-lost' ||
    input.renderer === 'blocked'
  ) {
    return { state: 'failed', reason: 'renderer' };
  }
  if (input.connection === 'error') return { state: 'failed', reason: 'stream' };
  if (input.connection === 'stale') return { state: 'stale' };
  return QUIET;
}
