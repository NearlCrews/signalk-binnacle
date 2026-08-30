import { describe, expect, it } from 'vitest';
import { formatClockTime } from '$shared/lib';
import type { CompanionReport } from './companion-client';
import { analyzerTitle, latestCompanionHeadline } from './companion-reports';

function report(overrides: Partial<CompanionReport>): CompanionReport {
  return {
    analyzerId: 'maintenance',
    message: 'Oil service due in 20 hours.',
    state: 'nominal',
    timestampMs: Date.UTC(2026, 7, 28, 10, 0),
    ...overrides,
  };
}

describe('analyzerTitle', () => {
  it('uses the known analyzer titles and humanizes unknown ids', () => {
    expect(analyzerTitle('maintenance')).toBe('Maintenance Advisor');
    expect(analyzerTitle('forecast')).toBe('Weather Outlook Advisor');
    expect(analyzerTitle('cabin-climate_watch')).toBe('Cabin climate watch');
    expect(analyzerTitle('constructor')).toBe('Constructor');
  });
});

describe('latestCompanionHeadline', () => {
  it('quotes the newest standing report with its clock time', () => {
    const newest = report({ analyzerId: 'health', timestampMs: Date.UTC(2026, 7, 28, 12, 0) });
    const headline = latestCompanionHeadline([
      report({ analyzerId: 'maintenance', timestampMs: Date.UTC(2026, 7, 28, 10, 0) }),
      { ...newest, message: 'Bank holding charge well.\nCycled twice this week.' },
    ]);
    expect(headline).toBe(
      `Battery Health Advisor: Bank holding charge well. (${formatClockTime(newest.timestampMs ?? 0)})`,
    );
  });

  it('skips warn entries and returns undefined when nothing stands', () => {
    expect(latestCompanionHeadline([])).toBeUndefined();
    expect(
      latestCompanionHeadline([
        report({ state: 'warn', message: 'maintenance report unavailable: budget exhausted' }),
      ]),
    ).toBeUndefined();
  });

  it('omits the clock for a report without a timestamp and bounds the length', () => {
    expect(
      latestCompanionHeadline([report({ timestampMs: undefined, message: 'Short note.' })]),
    ).toBe('Maintenance Advisor: Short note.');
    const long = latestCompanionHeadline([
      report({ timestampMs: undefined, message: 'w'.repeat(400) }),
    ]);
    expect(long?.length).toBe(160);
    expect(long?.endsWith('…')).toBe(true);
  });
});
