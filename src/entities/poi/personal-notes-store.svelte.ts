import type { Bbox4 } from '$shared/geo';
import { bboxContainsPoint } from '$shared/geo';
import type { NotePoint } from './note-point';

const MAX_PENDING_MUTATIONS = 512;

function samePoint(left: NotePoint, right: NotePoint): boolean {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.category === right.category &&
    left.skIcon === right.skIcon &&
    left.position.latitude === right.position.latitude &&
    left.position.longitude === right.position.longitude &&
    left.ownedByBinnacle === right.ownedByBinnacle
  );
}

// Session-scoped confirmed-write overlay. Signal K remains the source of record. These entries only
// bridge the interval between a successful write and a later collection refresh, so a slow or failed
// refresh cannot undo an accepted create, edit, move, or delete on the chart.
export class PersonalNotesStore {
  version = $state(0);
  refreshVersion = $state(0);

  #upserts = new Map<string, NotePoint>();
  #deletions = new Map<string, NotePoint['position']>();

  upsert(note: NotePoint): void {
    if (!note.ownedByBinnacle) return;
    this.#deletions.delete(note.id);
    this.#upserts.delete(note.id);
    this.#upserts.set(note.id, note);
    this.#trim();
    this.version += 1;
  }

  remove(note: Pick<NotePoint, 'id' | 'position' | 'ownedByBinnacle'>): void {
    if (!note.ownedByBinnacle) return;
    this.#upserts.delete(note.id);
    this.#deletions.delete(note.id);
    this.#deletions.set(note.id, note.position);
    this.#trim();
    this.version += 1;
  }

  requestRefresh(): void {
    this.refreshVersion += 1;
  }

  // Merge confirmed local outcomes over a provider snapshot. Personal writes take priority, and
  // tombstones suppress stale cached copies. The hard cap is applied after local notes are admitted
  // so a just-created mark cannot disappear behind a full third-party result set.
  merge(remote: readonly NotePoint[], viewport: Bbox4, limit: number): NotePoint[] {
    const allPersonal = [...this.#upserts.values()];
    const personal = allPersonal.filter((note) => bboxContainsPoint(viewport, note.position));
    // Suppress every provider copy, including a stale pre-move copy whose old position remains in
    // this viewport after the confirmed note moved outside it.
    const personalIds = new Set(allPersonal.map((note) => note.id));
    const remaining = Math.max(0, limit - personal.length);
    const provider = remote
      .filter((note) => !this.#deletions.has(note.id) && !personalIds.has(note.id))
      .slice(0, remaining);
    return [...personal.slice(0, limit), ...provider];
  }

  // A complete successful viewport response can retire matching optimistic entries. An exact match
  // is required for an upsert, so an older provider snapshot cannot overwrite a confirmed edit.
  reconcile(remote: readonly NotePoint[], viewport: Bbox4, complete: boolean): void {
    const byId = new Map(remote.map((note) => [note.id, note]));
    let changed = false;
    for (const [id, note] of this.#upserts) {
      const accepted = byId.get(id);
      if (accepted && samePoint(note, accepted)) {
        this.#upserts.delete(id);
        changed = true;
      }
    }
    if (complete) {
      for (const [id, position] of this.#deletions) {
        if (bboxContainsPoint(viewport, position) && !byId.has(id)) {
          this.#deletions.delete(id);
          changed = true;
        }
      }
    }
    if (changed) this.version += 1;
  }

  hasUpsert(id: string): boolean {
    return this.#upserts.has(id);
  }

  hasDeletion(id: string): boolean {
    return this.#deletions.has(id);
  }

  #trim(): void {
    while (this.#upserts.size + this.#deletions.size > MAX_PENDING_MUTATIONS) {
      const oldestUpsert = this.#upserts.keys().next().value as string | undefined;
      if (oldestUpsert !== undefined) {
        this.#upserts.delete(oldestUpsert);
        continue;
      }
      const oldestDeletion = this.#deletions.keys().next().value as string | undefined;
      if (oldestDeletion !== undefined) this.#deletions.delete(oldestDeletion);
      else break;
    }
  }
}
