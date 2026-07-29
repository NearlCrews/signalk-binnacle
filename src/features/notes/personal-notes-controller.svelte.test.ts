import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalNotesStore } from '$entities/poi';
import type { NoteSelection } from './notes-client';
import * as client from './personal-notes-client';
import { createPersonalNotesController } from './personal-notes-controller.svelte';

vi.mock('./personal-notes-client', () => ({
  deletePersonalNote: vi.fn(),
  probePersonalNotesCapability: vi.fn(),
  savePersonalNote: vi.fn(),
}));

const ID = '123e4567-e89b-42d3-a456-426614174000';
const selection = (ownedByBinnacle = true): NoteSelection => ({
  id: ID,
  name: 'Quiet cove',
  description: 'Old text',
  category: 'anchorage',
  skIcon: 'anchorage',
  position: { latitude: 44, longitude: -86 },
  ownedByBinnacle,
});
const input = {
  name: 'Updated cove',
  text: 'New text',
  category: 'anchorage' as const,
  position: { latitude: 44.1, longitude: -86.1 },
};

function makeController(writeBlocked = false) {
  const personalNotes = new PersonalNotesStore();
  const requestWriteAccess = vi.fn().mockResolvedValue(undefined);
  const onSelect = vi.fn();
  const invalidateDetail = vi.fn();
  const controller = createPersonalNotesController({
    origin: 'http://sk',
    getToken: () => 'token',
    writeBlocked: () => writeBlocked,
    requestWriteAccess,
    personalNotes,
    onSelect,
    invalidateDetail,
  });
  return { controller, personalNotes, requestWriteAccess, onSelect, invalidateDetail };
}

describe('createPersonalNotesController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.probePersonalNotesCapability).mockResolvedValue('read-write');
    vi.mocked(client.deletePersonalNote).mockResolvedValue('ok');
    vi.mocked(client.savePersonalNote).mockResolvedValue({
      result: 'ok',
      note: {
        id: ID,
        name: input.name,
        description: input.text,
        category: input.category,
        position: input.position,
        skIcon: input.category,
        ownedByBinnacle: true,
      },
    });
  });

  it('keeps a failed create and its editor state open', async () => {
    const { controller } = makeController();
    vi.mocked(client.savePersonalNote).mockResolvedValue({ result: 'failed' });
    controller.openAdd({ latitude: 44, longitude: -86 });
    await controller.save(input);
    expect(controller.editor).toEqual({
      kind: 'add',
      position: { latitude: 44, longitude: -86 },
    });
    expect(controller.error).toContain('Could not save');
  });

  it('requests read/write access after a refused write without closing the editor', async () => {
    const { controller, requestWriteAccess } = makeController();
    vi.mocked(client.savePersonalNote).mockResolvedValue({ result: 'access-denied' });
    controller.openAdd({ latitude: 44, longitude: -86 });
    await controller.save(input);
    expect(controller.editor?.kind).toBe('add');
    expect(requestWriteAccess).toHaveBeenCalledOnce();
  });

  it('admits an accepted edit locally before requesting a refresh', async () => {
    const { controller, personalNotes, onSelect, invalidateDetail } = makeController();
    controller.openEdit(selection());
    await controller.save(input);
    expect(personalNotes.hasUpsert(ID)).toBe(true);
    expect(personalNotes.refreshVersion).toBe(1);
    expect(controller.editor).toBeUndefined();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: input.name }));
    expect(invalidateDetail).toHaveBeenCalledWith(ID);
  });

  it('never opens or deletes an unowned provider note', async () => {
    const { controller } = makeController();
    const foreign = selection(false);
    controller.openEdit(foreign);
    await controller.remove(foreign);
    expect(controller.editor).toBeUndefined();
    expect(client.deletePersonalNote).not.toHaveBeenCalled();
  });

  it('suppresses an accepted delete through the follow-up refresh', async () => {
    const { controller, personalNotes, onSelect } = makeController();
    await controller.remove(selection());
    expect(personalNotes.hasDeletion(ID)).toBe(true);
    expect(personalNotes.refreshVersion).toBe(1);
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });
});
