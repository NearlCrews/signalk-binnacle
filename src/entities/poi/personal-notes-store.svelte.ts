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

// Upserts and tombstones live in separate maps, so each carries the sequence it was recorded at.
// Insertion order alone only ranks entries within one map, and trimming has to rank them across
// both.
interface PendingUpsert {
  note: NotePoint;
  sequence: number;
}

interface PendingDeletion {
  position: NotePoint['position'];
  sequence: number;
}

// Session-scoped confirmed-write overlay. Signal K remains the source of record. These entries only
// bridge the interval between a successful write and a later collection refresh, so a slow or failed
// refresh cannot undo an accepted create, edit, move, or delete on the chart.
export class PersonalNotesStore {
  version = $state(0);
  refreshVersion = $state(0);

  #upserts = new Map<string, PendingUpsert>();
  #deletions = new Map<string, PendingDeletion>();
  #sequence = 0;

  upsert(note: NotePoint): void {
    if (!note.ownedByBinnacle) return;
    this.#deletions.delete(note.id);
    this.#upserts.delete(note.id);
    this.#upserts.set(note.id, { note, sequence: this.#nextSequence() });
    this.#trim();
    this.version += 1;
  }

  remove(note: Pick<NotePoint, 'id' | 'position' | 'ownedByBinnacle'>): void {
    if (!note.ownedByBinnacle) return;
    this.#upserts.delete(note.id);
    this.#deletions.delete(note.id);
    this.#deletions.set(note.id, { position: note.position, sequence: this.#nextSequence() });
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
    const allPersonal = [...this.#upserts.values()].map((entry) => entry.note);
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
    for (const [id, entry] of this.#upserts) {
      const accepted = byId.get(id);
      if (accepted && samePoint(entry.note, accepted)) {
        this.#upserts.delete(id);
        changed = true;
      }
    }
    if (complete) {
      for (const [id, entry] of this.#deletions) {
        if (bboxContainsPoint(viewport, entry.position) && !byId.has(id)) {
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

  #nextSequence(): number {
    this.#sequence += 1;
    return this.#sequence;
  }

  // Evicts oldest-first across both maps, so a confirmed create cannot disappear from the chart
  // while an older tombstone survives. Each map stays in ascending sequence order because a
  // re-recorded id is deleted before it is set again, so the first entry of each is its oldest.
  #trim(): void {
    while (this.#upserts.size + this.#deletions.size > MAX_PENDING_MUTATIONS) {
      const upsert = this.#upserts.entries().next().value as [string, PendingUpsert] | undefined;
      const deletion = this.#deletions.entries().next().value as
        | [string, PendingDeletion]
        | undefined;
      if (upsert && (!deletion || upsert[1].sequence < deletion[1].sequence)) {
        this.#upserts.delete(upsert[0]);
      } else if (deletion) {
        this.#deletions.delete(deletion[0]);
      } else {
        break;
      }
    }
  }
}
