import { describe, expect, it } from 'vitest';
import {
  MAX_PERSONAL_NOTE_NAME_LENGTH,
  MAX_PERSONAL_NOTE_TEXT_LENGTH,
  PERSONAL_NOTE_NAMESPACE,
  personalNoteOwnership,
  personalNoteResource,
} from './personal-note-contract';

describe('personal note contract', () => {
  it('builds a bounded standard Signal K note with the exact ownership marker', () => {
    const resource = personalNoteResource({
      name: `  ${'N'.repeat(200)}  `,
      text: `${'T'.repeat(5_000)}\r\n`,
      category: 'anchorage',
      symbol: 'custom:quiet-cove',
      position: { latitude: 44, longitude: -86 },
    });
    expect(resource?.title).toHaveLength(MAX_PERSONAL_NOTE_NAME_LENGTH);
    expect(resource?.description).toHaveLength(MAX_PERSONAL_NOTE_TEXT_LENGTH);
    expect(resource).toMatchObject({
      mimeType: 'text/plain',
      position: { latitude: 44, longitude: -86 },
      properties: {
        skIcon: 'custom:quiet-cove',
        source: 'Binnacle Chartplotter',
        [PERSONAL_NOTE_NAMESPACE]: {
          schemaVersion: 1,
          kind: 'personal-note',
          category: 'anchorage',
        },
      },
    });
  });

  it('rejects invalid coordinates and strips unsupported ownership claims', () => {
    expect(
      personalNoteResource({
        name: 'Invalid',
        text: '',
        category: 'generic',
        position: { latitude: 91, longitude: 0 },
      }),
    ).toBeUndefined();
    expect(
      personalNoteOwnership({ schemaVersion: 1, kind: 'personal-note', category: 'unknown-value' }),
    ).toBeUndefined();
    expect(
      personalNoteOwnership({ schemaVersion: 2, kind: 'personal-note', category: 'generic' }),
    ).toBeUndefined();
  });
});
