import { describe, expect, it } from 'vitest';
import { describeConnection } from './connection-description';

describe('connection descriptions', () => {
  it('never describes a connecting socket as connected', () => {
    expect(describeConnection('connecting', false)).toBe('Connecting to the Signal K server.');
    expect(describeConnection('connecting', true)).toBe('Connecting to the Signal K server.');
  });

  it('confirms an open socket without inventing a data fault', () => {
    expect(describeConnection('open', false)).toBe('Connected to the Signal K server.');
  });

  it('explains a silent data feed only while the socket remains open', () => {
    expect(describeConnection('open', true)).toContain('no data has arrived for 30 seconds');
  });

  it.each(['closed', 'reconnecting'] as const)('explains recovery while %s', (phase) => {
    expect(describeConnection(phase, false)).toContain('Reconnect retries now');
    expect(describeConnection(phase, true)).toBe(describeConnection(phase, false));
  });
});
