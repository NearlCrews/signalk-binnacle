import { describe, expect, it } from 'vitest';
import type { NormalizedSection } from './notes-detail';
import {
  dangerFlagText,
  flagText,
  isDangerFlag,
  isRedundantNoteLabel,
  orderSections,
} from './notes-present';

const section = (id: string): NormalizedSection => ({ id, title: id, items: [] });

describe('orderSections', () => {
  it('leads with facts and trails with reviews and provenance', () => {
    const input = ['source', 'review', 'featuredReview', 'fuel', 'feature', 'depth'].map(section);
    expect(orderSections(input).map((s) => s.id)).toEqual([
      'feature',
      'depth',
      'fuel',
      'review',
      'featuredReview',
      'source',
    ]);
  });

  it('keeps an unknown section in the middle, ahead of reviews and source', () => {
    const input = ['source', 'mystery', 'review', 'fuel'].map(section);
    expect(orderSections(input).map((s) => s.id)).toEqual(['fuel', 'mystery', 'review', 'source']);
  });

  it('is stable within a rank', () => {
    const input = ['notes', 'information', 'remarks'].map(section);
    expect(orderSections(input).map((s) => s.id)).toEqual(['notes', 'information', 'remarks']);
  });
});

describe('isRedundantNoteLabel', () => {
  it('drops a label that repeats the section title or is generic', () => {
    expect(isRedundantNoteLabel('Notes', 'Notes')).toBe(true);
    expect(isRedundantNoteLabel('Information', 'Feature')).toBe(true);
    expect(isRedundantNoteLabel('Remarks', 'Remarks')).toBe(true);
  });

  it('keeps a meaningful label', () => {
    expect(isRedundantNoteLabel('Approach advice', 'Notes')).toBe(false);
  });
});

describe('isDangerFlag', () => {
  it('matches the producer danger flag and nothing else', () => {
    expect(isDangerFlag('Dangerous', 'flag')).toBe(true);
    expect(isDangerFlag('Transient', 'flag')).toBe(false);
    expect(isDangerFlag('Dangerous', 'text')).toBe(false);
  });

  it('distinguishes positive, negative, and unknown provider assessments', () => {
    expect(dangerFlagText(true)).toBe('Dangerous to navigation');
    expect(dangerFlagText(false)).toBe('Provider does not mark this feature as dangerous');
    for (const value of ['unknown', 'false', 0, 1]) {
      expect(dangerFlagText(value)).toBe('Danger status unknown');
      expect(flagText(value)).toBe('Unknown');
    }
    expect(flagText(false)).toBe('No');
    expect(flagText(true)).toBe('Yes');
  });
});
