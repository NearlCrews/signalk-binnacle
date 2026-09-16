import { describe, expect, it, vi } from 'vitest';
import { createSafetyHistory, type SafetyChannel } from './safety-controller.svelte';

describe('dedicated safety chronology', () => {
  it('retains the last alarm through lost monitoring and only clears after a current observation', () => {
    const record = vi.fn();
    const history = createSafetyHistory(record);
    const channel: SafetyChannel = {
      id: 'shallow',
      rank: 3,
      text: '',
      history: { label: 'Shallow water', active: true },
    };
    history.update([channel]);
    history.update([
      { ...channel, history: { label: 'Shallow water', active: false, status: 'unavailable' } },
    ]);
    history.update([
      { ...channel, history: { label: 'Shallow water', active: false, status: 'unavailable' } },
    ]);
    expect(record.mock.calls.map(([event]) => event.kind)).toEqual(['raised', 'status']);
    expect(record.mock.calls[1][0].detail).toContain('Monitoring unavailable');
    history.update([{ ...channel, history: { label: 'Shallow water', active: false } }]);
    expect(record.mock.calls.map(([event]) => event.kind)).toEqual([
      'raised',
      'status',
      'status',
      'cleared',
    ]);
    expect(record.mock.calls.every(([event]) => event.source === 'shallow')).toBe(true);
  });

  it('does not claim a clear when off-course alarm ownership transfers to the server', () => {
    const record = vi.fn();
    const history = createSafetyHistory(record);
    const channel: SafetyChannel = {
      id: 'xte',
      rank: 4,
      text: '',
      history: { label: 'Off course', active: true },
    };
    history.update([channel]);
    history.update([
      { ...channel, history: { label: 'Off course', active: false, status: 'delegated' } },
    ]);
    history.update([channel]);
    expect(record.mock.calls.map(([event]) => event.kind)).toEqual(['raised', 'status', 'status']);
    expect(record.mock.calls[1][0].detail).toContain('Server alarm');
  });

  it('records a successful local acknowledgment even when it clears the alarm latch', () => {
    const record = vi.fn();
    const history = createSafetyHistory(record);
    const channel: SafetyChannel = {
      id: 'anchor',
      rank: 2,
      text: '',
      history: { label: 'Anchor drag', active: true, acknowledgeSequence: 0 },
    };
    history.update([channel]);
    const acknowledged = {
      ...channel,
      history: { label: 'Anchor drag', active: false, acknowledgeSequence: 1 },
    };
    history.update([acknowledged]);
    history.update([acknowledged]);
    expect(record.mock.calls.map(([event]) => event.kind)).toEqual([
      'raised',
      'acknowledged',
      'cleared',
    ]);
  });

  it('does not repeat an acknowledgment when monitoring briefly becomes unavailable', () => {
    const record = vi.fn();
    const history = createSafetyHistory(record);
    const channel: SafetyChannel = {
      id: 'anchor',
      rank: 2,
      text: '',
      history: { label: 'Anchor drag', active: true, acknowledged: true },
    };
    history.update([channel]);
    history.update([
      {
        ...channel,
        history: {
          label: 'Anchor drag',
          active: false,
          status: 'unavailable',
          acknowledged: false,
        },
      },
    ]);
    history.update([channel]);
    expect(record.mock.calls.filter(([event]) => event.kind === 'acknowledged')).toHaveLength(1);
    expect(record.mock.calls.filter(([event]) => event.kind === 'cleared')).toHaveLength(0);
  });

  it('records lifecycle and acknowledgments independently of muted speech or changing text', () => {
    const record = vi.fn();
    const history = createSafetyHistory(record);
    const channel: SafetyChannel = {
      id: 'mob',
      rank: 0,
      text: '',
      history: { label: 'Man overboard', active: true },
    };
    history.update([channel]);
    history.update([{ ...channel, text: 'Range changed.' }]);
    history.update([
      { ...channel, history: { label: 'Man overboard', active: true, acknowledged: true } },
    ]);
    history.update([{ ...channel, history: { label: 'Man overboard', active: false } }]);
    expect(record.mock.calls.map(([event]) => event.kind)).toEqual([
      'raised',
      'acknowledged',
      'cleared',
    ]);
  });

  it('tracks simultaneous hazards independently and records a device mute once', () => {
    const record = vi.fn();
    const history = createSafetyHistory(record);
    const channels = ['anchor', 'collision', 'shallow', 'xte'].map((id) => ({
      id,
      rank: 1,
      text: '',
      history: { label: id, active: true, muted: true },
    }));
    history.update(channels);
    history.update(channels);
    expect(record).toHaveBeenCalledTimes(8);
    history.update(
      channels.map((channel) => ({ ...channel, history: { ...channel.history, active: false } })),
    );
    expect(record).toHaveBeenCalledTimes(12);
  });
});
