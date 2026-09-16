import type { ConnectionPhase } from '$shared/signalk';

export function describeConnection(phase: ConnectionPhase, dataStalled: boolean): string {
  if (phase === 'connecting') return 'Connecting to the Signal K server.';
  if (phase === 'open') {
    return dataStalled
      ? "Connected to Signal K, but no data has arrived for 30 seconds; check the server's data sources."
      : 'Connected to the Signal K server.';
  }
  return 'The link to the Signal K server dropped. Binnacle retries by itself, and Reconnect retries now.';
}
