import { describe, expect, it } from 'vitest';
import {
  logbookAnchorSuggestion,
  logbookCourseSuggestion,
  logbookHandoffSuggestion,
} from './suggestions';

describe('logbookHandoffSuggestion', () => {
  it('folds the facts summary into one sentence with terminal punctuation', () => {
    expect(logbookHandoffSuggestion('GPS fix live, SOG 5.2 kn')).toBe(
      'Watch handed over. GPS fix live, SOG 5.2 kn.',
    );
    expect(logbookHandoffSuggestion('All quiet.')).toBe('Watch handed over. All quiet.');
  });

  it('states only the handoff when the summary is empty or unusable', () => {
    expect(logbookHandoffSuggestion('')).toBe('Watch handed over.');
    expect(logbookHandoffSuggestion('   ')).toBe('Watch handed over.');
    expect(logbookHandoffSuggestion('bad\u0000summary')).toBe('Watch handed over.');
  });

  it('clips an oversized summary instead of dropping it', () => {
    const text = logbookHandoffSuggestion('x'.repeat(700));
    expect(text.startsWith('Watch handed over. ')).toBe(true);
    expect(text.length).toBeLessThanOrEqual('Watch handed over. '.length + 601);
  });
});

describe('logbookCourseSuggestion', () => {
  it('names the destination when one is given', () => {
    expect(logbookCourseSuggestion('started', 'Port Townsend')).toBe(
      'Navigation started to Port Townsend.',
    );
    expect(logbookCourseSuggestion('arrived', 'Port Townsend')).toBe('Arrived at Port Townsend.');
    expect(logbookCourseSuggestion('stopped', 'Port Townsend')).toBe(
      'Navigation to Port Townsend stopped.',
    );
  });

  it('states the plain fact when no destination name is known', () => {
    expect(logbookCourseSuggestion('started')).toBe('Navigation started.');
    expect(logbookCourseSuggestion('arrived')).toBe('Arrived at the destination.');
    expect(logbookCourseSuggestion('stopped', '  ')).toBe('Navigation stopped.');
  });
});

describe('logbookAnchorSuggestion', () => {
  it('reports the watch radius in whole meters when dropping', () => {
    expect(logbookAnchorSuggestion('dropped', 40.4)).toBe('Anchor down, watch radius 40 m.');
    expect(logbookAnchorSuggestion('dropped')).toBe('Anchor down.');
    expect(logbookAnchorSuggestion('dropped', Number.NaN)).toBe('Anchor down.');
    expect(logbookAnchorSuggestion('dropped', -5)).toBe('Anchor down.');
  });

  it('ignores the radius when raising', () => {
    expect(logbookAnchorSuggestion('raised', 40)).toBe('Anchor up.');
    expect(logbookAnchorSuggestion('raised')).toBe('Anchor up.');
  });
});
