import { createRetryableLazyUiLoader } from '$shared/lib';

export type { PoiViewState } from '$entities/poi';
export { default as NoteDetailPanel } from './NoteDetailPanel.svelte';
export type { NotePoint, NoteSelection } from './notes-client';
export { createNoteDetailLoader, type NoteDetailLoader } from './notes-detail';
export { createNotesOverlay, type NotesOverlay } from './notes-overlay';
export {
  MAX_PERSONAL_NOTE_NAME_LENGTH,
  MAX_PERSONAL_NOTE_TEXT_LENGTH,
  type PersonalNoteInput,
} from './personal-note-contract';
export type { PersonalNotesCapability } from './personal-notes-client';
export {
  createPersonalNotesController,
  type PersonalNoteEditorState,
} from './personal-notes-controller.svelte';

const personalNoteDialogLoader = createRetryableLazyUiLoader(
  () => import('./PersonalNoteDialog.svelte'),
);

export function loadPersonalNoteDialog(): Promise<typeof import('./PersonalNoteDialog.svelte')> {
  return personalNoteDialogLoader();
}
