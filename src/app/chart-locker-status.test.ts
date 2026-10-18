import { describe, expect, it } from 'vitest';
import { chartLockerSummary } from './chart-locker-status';

describe('chartLockerSummary', () => {
  it('reports the cached amount while serving, and nothing to act on', () => {
    const summary = chartLockerSummary('serving', 10_400_000);
    expect(summary.value).toMatch(/^[\d.]+ MB cached$/);
    expect(summary.title).toMatch(/^Offline charts: online, cache [\d.]+ MB$/);
    expect(summary).toMatchObject({ problem: false, signIn: false });
    expect(chartLockerSummary('serving', null).value).toBe('Cache ready');
  });

  it('keeps access, transport, and server failures distinct', () => {
    expect(chartLockerSummary('needs-login', null)).toMatchObject({
      value: 'Sign in to use',
      problem: true,
      signIn: true,
    });
    expect(chartLockerSummary('needs-admin', null)).toMatchObject({
      value: 'Administrator needed',
      signIn: true,
    });
    expect(chartLockerSummary('access-error', null)).toMatchObject({
      value: 'Access refused',
      problem: true,
      signIn: false,
    });
    expect(chartLockerSummary('offline', null).title).toBe('Offline charts: not responding');
    expect(chartLockerSummary('error', null).value).toBe('Server error');
  });

  it('treats a check in progress as no problem yet', () => {
    expect(chartLockerSummary('checking', null)).toMatchObject({
      value: 'Checking access',
      problem: false,
    });
  });
});
