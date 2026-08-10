import { describe, expect, it } from 'vitest';
import { radarHelmHealth } from './radar-health';

const base = {
  echoShown: true,
  operationalStatus: 'transmit' as const,
  connection: 'live' as const,
  renderer: 'ready' as const,
};

describe('radarHelmHealth', () => {
  it('stays quiet while healthy, hidden, off, or standing by', () => {
    expect(radarHelmHealth(base).state).toBe('quiet');
    expect(radarHelmHealth({ ...base, echoShown: false, connection: 'error' }).state).toBe('quiet');
    expect(
      radarHelmHealth({ ...base, operationalStatus: 'standby', connection: 'error' }).state,
    ).toBe('quiet');
    expect(radarHelmHealth({ ...base, operationalStatus: 'off', renderer: 'error' }).state).toBe(
      'quiet',
    );
    expect(
      radarHelmHealth({ ...base, operationalStatus: undefined, connection: 'error' }).state,
    ).toBe('quiet');
  });

  it('keeps connection grace quiet: reconnect blips are routine', () => {
    expect(radarHelmHealth({ ...base, connection: 'connecting' }).state).toBe('quiet');
    expect(radarHelmHealth({ ...base, connection: 'waiting' }).state).toBe('quiet');
  });

  it('grades a stale stream while transmitting', () => {
    expect(radarHelmHealth({ ...base, connection: 'stale' })).toEqual({ state: 'stale' });
    expect(radarHelmHealth({ ...base, operationalStatus: 'warming', connection: 'stale' })).toEqual(
      {
        state: 'stale',
      },
    );
  });

  it('grades a transport error as a stream failure', () => {
    expect(radarHelmHealth({ ...base, connection: 'error' })).toEqual({
      state: 'failed',
      reason: 'stream',
    });
  });

  it('grades renderer trouble as a renderer failure, outranking the stream state', () => {
    for (const renderer of ['error', 'context-lost', 'blocked'] as const) {
      expect(radarHelmHealth({ ...base, renderer, connection: 'error' })).toEqual({
        state: 'failed',
        reason: 'renderer',
      });
    }
  });
});
