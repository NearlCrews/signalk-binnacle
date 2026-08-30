import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthController } from '$shared/signalk';
import CompanionAiPanel from './CompanionAiPanel.svelte';
import type { CompanionAiController } from './companion-ai-controller.svelte';
import type { CompanionReport } from './companion-client';

function report(overrides: Partial<CompanionReport>): CompanionReport {
  return {
    analyzerId: 'maintenance',
    message: 'Oil service due in 20 hours.',
    state: 'nominal',
    timestampMs: Date.UTC(2026, 7, 28, 10, 0),
    ...overrides,
  };
}

function renderPanel(
  overrides: Partial<CompanionAiController> = {},
  auth: Partial<AuthController> = { writeBlocked: false },
): string {
  const controller: CompanionAiController = {
    reports: [],
    availability: 'available',
    loading: false,
    busyAnalyzerIds: new Set<string>(),
    ackNoteFor: () => undefined,
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(async () => undefined),
    runNow: vi.fn(async () => undefined),
    ...overrides,
  };
  return render(CompanionAiPanel, {
    props: { controller, auth: auth as AuthController, onClose: vi.fn() },
  }).body.replaceAll(/\s+/g, ' ');
}

describe('CompanionAiPanel', () => {
  it('frames the reports as advisory, never navigation truth', () => {
    const html = renderPanel();
    expect(html).toContain('They are AI summaries for review, never navigation truth.');
  });

  it('explains the absent plugin instead of hiding the feature', () => {
    const html = renderPanel({ availability: 'absent' });
    expect(html).toContain('Either the companion plugin is not installed');
    expect(html).toContain('signalk-openrouter-companion');
    expect(html).toContain('Check again');
  });

  it('keeps loading and failure states distinct, retaining accepted reports', () => {
    expect(renderPanel({ availability: 'unknown', loading: true })).toContain(
      'Checking for companion reports…',
    );
    const failed = renderPanel({
      availability: 'unavailable',
      reports: [report({})],
    });
    expect(failed).toContain('Companion reports could not be loaded.');
    expect(failed).toContain('Retry');
    expect(failed).toContain('Oil service due in 20 hours.');
  });

  it('renders each report card with its humanized title and warn treatment', () => {
    const html = renderPanel({
      reports: [
        report({}),
        report({
          analyzerId: 'forecast',
          state: 'warn',
          message: 'forecast report unavailable: budget exhausted',
        }),
      ],
    });
    expect(html).toContain('Maintenance Advisor');
    expect(html).toContain('Weather Outlook Advisor');
    expect(html).toContain('Report unavailable');
    expect(html).toContain('aria-label="Run now: Maintenance Advisor"');
  });

  it('surfaces a run ack note beside its own card', () => {
    const html = renderPanel({
      reports: [report({})],
      ackNoteFor: (analyzerId) =>
        analyzerId === 'maintenance'
          ? 'Run started. The report updates here when it completes.'
          : undefined,
    });
    expect(html).toContain('Run started. The report updates here when it completes.');
  });

  it('blocks Run now and teaches the access fix when writes are blocked', () => {
    const html = renderPanel({ reports: [report({})] }, { writeBlocked: true });
    expect(html).toContain('analyzers cannot be run from here');
    expect(html).toContain('aria-label="Run now: Maintenance Advisor" disabled');
  });
});
