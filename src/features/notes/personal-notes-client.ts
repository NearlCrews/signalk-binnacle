import type { NotePoint } from '$entities/poi';
import {
  fetchAuthedJsonOutcome,
  mutationResultFor,
  type ResourceMutationResult,
  sendJson,
} from '$shared/signalk';
import { NOTES_PATH, NOTES_V1_PATH } from './notes-client';
import {
  cleanPersonalNoteInput,
  isPersonalNoteId,
  type PersonalNoteInput,
  personalNoteResource,
} from './personal-note-contract';

export type PersonalNotesCapability =
  | 'unknown'
  | 'read-write'
  | 'read-only-v1'
  | 'unavailable'
  | 'error';

// Retained as an alias so the notes call sites keep reading in their own vocabulary; the shape and
// the status mapping are the shared resource-write ones.

// Probe only one entry. The v2 route is the sole write transport; a v1-only response is useful for
// display but must never be mistaken for edit capability.
export async function probePersonalNotesCapability(
  base: string,
  token: string | undefined,
): Promise<PersonalNotesCapability> {
  const query = '?limit=1';
  const v2 = await fetchAuthedJsonOutcome<unknown>(`${base}${NOTES_PATH}${query}`, token);
  if (v2.state === 'ok') return 'read-write';
  if (v2.state === 'failed') return 'error';
  const v1 = await fetchAuthedJsonOutcome<unknown>(`${base}${NOTES_V1_PATH}${query}`, token);
  if (v1.state === 'ok') return 'read-only-v1';
  return v1.state === 'not-found' ? 'unavailable' : 'error';
}

export async function savePersonalNote(
  base: string,
  token: string | undefined,
  id: string,
  input: PersonalNoteInput,
): Promise<{ result: ResourceMutationResult; note?: NotePoint }> {
  if (!isPersonalNoteId(id)) return { result: 'failed' };
  const clean = cleanPersonalNoteInput(input);
  const resource = clean ? personalNoteResource(clean) : undefined;
  if (!clean || !resource) return { result: 'failed' };
  const response = await sendJson(
    `${base}${NOTES_PATH}/${encodeURIComponent(id)}`,
    token,
    'PUT',
    resource,
  );
  const result = mutationResultFor(response);
  return {
    result,
    ...(result === 'ok'
      ? {
          note: {
            id,
            name: clean.name,
            description: clean.text || undefined,
            position: clean.position,
            category: clean.category,
            skIcon: clean.symbol ?? clean.category,
            ownedByBinnacle: true,
            source: 'Binnacle Chartplotter',
          },
        }
      : {}),
  };
}

export async function deletePersonalNote(
  base: string,
  token: string | undefined,
  note: Pick<NotePoint, 'id' | 'ownedByBinnacle'>,
): Promise<ResourceMutationResult> {
  if (!note.ownedByBinnacle || !isPersonalNoteId(note.id)) return 'failed';
  return mutationResultFor(
    await sendJson(`${base}${NOTES_PATH}/${encodeURIComponent(note.id)}`, token, 'DELETE'),
  );
}
