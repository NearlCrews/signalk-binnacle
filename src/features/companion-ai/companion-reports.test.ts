import { describe, expect, it } from 'vitest';
import { DAY_MS } from '$shared/lib';
import type { CompanionReport } from './companion-client';
import { analyzerTitle, companionReportTime, latestCompanionHeadline } from './companion-reports';

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
    const now = (newest.timestampMs ?? 0) + DAY_MS;
    const headline = latestCompanionHeadline(
      [
        report({ analyzerId: 'maintenance', timestampMs: Date.UTC(2026, 7, 28, 10, 0) }),
        { ...newest, message: 'Bank holding charge well.\nCycled twice this week.' },
      ],
      now,
    );
    expect(headline).toBe(
      `Advisory, ${companionReportTime(newest.timestampMs, now)}; Battery Health Advisor: Bank holding charge well.`,
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

  it('keeps unknown time ahead of the quoted report even when text is truncated', () => {
    expect(
      latestCompanionHeadline([report({ timestampMs: undefined, message: 'Short note.' })]),
    ).toBe('Advisory, Report time unknown; Maintenance Advisor: Short note.');
    const long = latestCompanionHeadline([
      report({ timestampMs: undefined, message: 'w'.repeat(400) }),
    ]);
    expect(long?.length).toBe(160);
    expect(long?.endsWith('…')).toBe(true);
    expect(long?.startsWith('Advisory, Report time unknown;')).toBe(true);
  });
});

describe('companionReportTime', () => {
  it('labels missing, invalid, and future timestamps without claiming freshness', () => {
    expect(companionReportTime(undefined, 1_000)).toBe('Report time unknown');
    expect(companionReportTime(Number.NaN, 1_000)).toBe('Report time unknown');
    expect(companionReportTime(2_000, 1_000)).toContain('in the future; age unknown');
  });

  it('puts multiday age and the dated source time before any report body', () => {
    const timestamp = Date.UTC(2026, 8, 14, 12);
    const headline = latestCompanionHeadline(
      [report({ timestampMs: timestamp, message: 'x'.repeat(400) })],
      timestamp + 2 * DAY_MS,
    );
    expect(headline).toMatch(/^Advisory, 2 days old;/);
    expect(headline).toContain('Sep');
    expect(headline).toHaveLength(160);
  });
});
