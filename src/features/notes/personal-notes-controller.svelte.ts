import type { NotePoint, PersonalNotesStore } from '$entities/poi';
import { isLatLon, type LatLon } from '$shared/geo';
import { createBusyGate, uuidv4 } from '$shared/lib';
import type { NoteSelection } from './notes-client';
import type { PersonalNoteInput } from './personal-note-contract';
import {
  deletePersonalNote,
  type PersonalNotesCapability,
  probePersonalNotesCapability,
  savePersonalNote,
} from './personal-notes-client';

export type PersonalNoteEditorState =
  | { kind: 'add'; position: LatLon }
  | { kind: 'edit'; note: NoteSelection };

export interface PersonalNotesControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  writeBlocked: () => boolean;
  requestWriteAccess: () => Promise<void>;
  personalNotes: PersonalNotesStore;
  onSelect: (selection: NoteSelection | undefined) => void;
  invalidateDetail: (id: string) => void;
}

function selectionFor(note: NotePoint): NoteSelection {
  return {
    id: note.id,
    name: note.name,
    category: note.category,
    position: note.position,
    description: note.description,
    skIcon: note.skIcon,
    ownedByBinnacle: note.ownedByBinnacle,
    attribution: note.attribution ?? note.source,
    url: note.url,
  };
}

export function createPersonalNotesController(deps: PersonalNotesControllerDeps) {
  let capability = $state<PersonalNotesCapability>('unknown');
  let probing = $state(false);
  let editor = $state<PersonalNoteEditorState | undefined>();
  let busy = $state(false);
  let error = $state<string | undefined>();
  let probeGeneration = 0;

  async function probe(): Promise<void> {
    const generation = ++probeGeneration;
    probing = true;
    const next = await probePersonalNotesCapability(deps.origin, deps.getToken());
    if (generation !== probeGeneration) return;
    capability = next;
    probing = false;
  }

  function openAdd(position: LatLon): void {
    if (busy || !isLatLon(position)) return;
    error = undefined;
    editor = { kind: 'add', position };
  }

  function openEdit(note: NoteSelection): void {
    if (busy || !note.ownedByBinnacle || !isLatLon(note.position)) return;
    error = undefined;
    editor = { kind: 'edit', note };
  }

  function cancelEdit(): void {
    if (busy) return;
    error = undefined;
    editor = undefined;
  }

  const withBusy = createBusyGate(
    () => busy,
    (next) => {
      busy = next;
    },
  );

  async function performSave(input: PersonalNoteInput): Promise<void> {
    if (!editor) return;
    if (deps.writeBlocked()) {
      error = 'Binnacle has read-only access. Request read and write access to save this note.';
      return;
    }
    if (capability === 'read-only-v1') {
      error =
        'This server exposes notes through the legacy read-only API. A v2 notes provider is needed.';
      return;
    }
    if (capability === 'unavailable') {
      error =
        'No Signal K notes provider is available. Enable the built-in Resources Provider, then check again.';
      return;
    }
    const current = editor;
    const id = current.kind === 'edit' ? current.note.id : uuidv4();
    error = undefined;
    const outcome = await savePersonalNote(deps.origin, deps.getToken(), id, input);
    if (outcome.result === 'access-denied') {
      error =
        'Signal K refused the write. The note is still open while read and write access is requested.';
      void deps.requestWriteAccess();
      return;
    }
    if (outcome.result === 'unavailable') {
      capability = 'unavailable';
      error = 'The Signal K notes provider does not accept writes. The note is still open.';
      return;
    }
    if (outcome.result !== 'ok' || !outcome.note) {
      error = 'Could not save the note. Check the connection, then try again.';
      return;
    }
    capability = 'read-write';
    deps.personalNotes.upsert(outcome.note);
    deps.personalNotes.requestRefresh();
    deps.invalidateDetail(id);
    editor = undefined;
    deps.onSelect(selectionFor(outcome.note));
  }
  const save = withBusy(performSave);

  async function performRemove(note: NoteSelection): Promise<void> {
    if (!note.ownedByBinnacle) return;
    if (deps.writeBlocked()) {
      error = 'Binnacle has read-only access. Request read and write access to delete this note.';
      return;
    }
    error = undefined;
    const result = await deletePersonalNote(deps.origin, deps.getToken(), note);
    if (result === 'access-denied') {
      error =
        'Signal K refused the delete. The note remains selected while read and write access is requested.';
      void deps.requestWriteAccess();
      return;
    }
    if (result === 'unavailable') {
      capability = 'unavailable';
      error = 'The Signal K notes provider does not accept deletes.';
      return;
    }
    if (result !== 'ok') {
      error = 'Could not delete the note. Check the connection, then try again.';
      return;
    }
    capability = 'read-write';
    deps.personalNotes.remove(note);
    deps.personalNotes.requestRefresh();
    deps.invalidateDetail(note.id);
    deps.onSelect(undefined);
  }
  const remove = withBusy(performRemove);

  function clearError(): void {
    error = undefined;
  }

  return {
    probe,
    openAdd,
    openEdit,
    cancelEdit,
    save,
    remove,
    clearError,
    get capability() {
      return capability;
    },
    get probing() {
      return probing;
    },
    get editor() {
      return editor;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
  };
}
