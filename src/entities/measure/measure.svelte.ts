import { isLatLon, type LatLon } from '$shared/geo';
import { rhumbBearingRad, rhumbDistanceMeters } from '$shared/nav';

export const MAX_MEASURE_POINTS = 1_000;
const MAX_MEASURE_HISTORY = 4_000;

export interface MeasureVertex {
  id: string;
  position: LatLon;
}

export interface MeasureLeg {
  id: string;
  fromId: string;
  toId: string;
  from: LatLon;
  to: LatLon;
  distanceMeters: number;
  bearingRad: number;
}

type MeasureHistoryEntry =
  | { kind: 'add'; vertexId: string }
  | { kind: 'move'; vertexId: string; prior: LatLon }
  | { kind: 'delete'; vertex: MeasureVertex; index: number };

function samePoint(left: LatLon | undefined, right: LatLon | undefined): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );
}

function leg(from: MeasureVertex, to: MeasureVertex): MeasureLeg {
  return {
    id: `${from.id}:${to.id}`,
    fromId: from.id,
    toId: to.id,
    from: from.position,
    to: to.position,
    distanceMeters: rhumbDistanceMeters(from.position, to.position),
    bearingRad: rhumbBearingRad(from.position, to.position),
  };
}

// The measure tool is transient by design. Stable store-lifetime vertex ids keep selection, Undo,
// and delayed map hits deterministic while coordinates move and sessions change. Inverse history
// entries avoid copying a 1,000-point measurement for each edit.
export class MeasureStore {
  #active = $state(false);
  #vertices = $state<MeasureVertex[]>([]);
  #selectedId = $state<string | undefined>();
  #moveArmed = $state(false);
  #movePreview = $state<LatLon | undefined>();
  #history = $state<MeasureHistoryEntry[]>([]);
  #nextId = 1;

  get active(): boolean {
    return this.#active;
  }

  get vertices(): readonly MeasureVertex[] {
    return this.#vertices;
  }

  get points(): readonly LatLon[] {
    return this.#vertices.map((vertex) => vertex.position);
  }

  get displayVertices(): readonly MeasureVertex[] {
    if (!this.#movePreview || !this.#selectedId) return this.#vertices;
    return this.#vertices.map((vertex) =>
      vertex.id === this.#selectedId
        ? { ...vertex, position: this.#movePreview as LatLon }
        : vertex,
    );
  }

  get displayPoints(): readonly LatLon[] {
    return this.displayVertices.map((vertex) => vertex.position);
  }

  get selectedId(): string | undefined {
    return this.#selectedId;
  }

  get selectedIndex(): number | undefined {
    if (!this.#selectedId) return undefined;
    const index = this.#vertices.findIndex((vertex) => vertex.id === this.#selectedId);
    return index >= 0 ? index : undefined;
  }

  get moveArmed(): boolean {
    return this.#moveArmed;
  }

  get movePreview(): LatLon | undefined {
    return this.#movePreview;
  }

  get isEmpty(): boolean {
    return this.#vertices.length === 0;
  }

  get atLimit(): boolean {
    return this.#vertices.length >= MAX_MEASURE_POINTS;
  }

  get canUndo(): boolean {
    return this.#history.length > 0;
  }

  legs = $derived.by<MeasureLeg[]>(() => {
    const out: MeasureLeg[] = [];
    for (let index = 1; index < this.#vertices.length; index += 1) {
      out.push(leg(this.#vertices[index - 1], this.#vertices[index]));
    }
    return out;
  });

  get displayLegs(): MeasureLeg[] {
    const out: MeasureLeg[] = [];
    const vertices = this.displayVertices;
    for (let index = 1; index < vertices.length; index += 1) {
      out.push(leg(vertices[index - 1], vertices[index]));
    }
    return out;
  }

  get lastLeg(): MeasureLeg | undefined {
    return this.legs[this.legs.length - 1];
  }

  get selectedIncomingLeg(): MeasureLeg | undefined {
    const index = this.selectedIndex;
    return index === undefined || index === 0 ? undefined : this.legs[index - 1];
  }

  get selectedOutgoingLeg(): MeasureLeg | undefined {
    const index = this.selectedIndex;
    return index === undefined ? undefined : this.legs[index];
  }

  get totalMeters(): number {
    return this.legs.reduce((total, item) => total + item.distanceMeters, 0);
  }

  get displayTotalMeters(): number {
    return this.displayLegs.reduce((total, item) => total + item.distanceMeters, 0);
  }

  get canDeleteSelected(): boolean {
    const index = this.selectedIndex;
    if (index === undefined) return false;
    const prior = this.#vertices[index - 1]?.position;
    const next = this.#vertices[index + 1]?.position;
    return !samePoint(prior, next);
  }

  start(): void {
    this.#resetSession();
    this.#active = true;
  }

  stop(): void {
    this.#active = false;
    this.#resetSession();
  }

  add(point: LatLon): boolean {
    if (!this.#active || this.atLimit || !isLatLon(point)) return false;
    const last = this.#vertices.at(-1)?.position;
    if (samePoint(last, point)) return false;
    const vertex: MeasureVertex = {
      id: `measure-${this.#nextId}`,
      position: { ...point },
    };
    this.#nextId += 1;
    this.cancelMove();
    this.#selectedId = undefined;
    this.#vertices = [...this.#vertices, vertex];
    this.#pushHistory({ kind: 'add', vertexId: vertex.id });
    return true;
  }

  select(vertexId: string | undefined): boolean {
    this.cancelMove();
    if (vertexId === undefined) {
      this.#selectedId = undefined;
      return true;
    }
    if (!this.#vertices.some((vertex) => vertex.id === vertexId)) return false;
    this.#selectedId = vertexId;
    return true;
  }

  selectIndex(index: number): boolean {
    const vertex = this.#vertices[index];
    return vertex ? this.select(vertex.id) : false;
  }

  selectPrevious(): boolean {
    const index = this.selectedIndex;
    if (index === undefined) return this.selectIndex(this.#vertices.length - 1);
    return this.selectIndex(index - 1);
  }

  selectNext(): boolean {
    const index = this.selectedIndex;
    if (index === undefined) return this.selectIndex(0);
    return this.selectIndex(index + 1);
  }

  armMove(): boolean {
    if (!this.#active || !this.#selectedId) return false;
    this.#movePreview = undefined;
    this.#moveArmed = true;
    return true;
  }

  previewSelected(point: LatLon): boolean {
    if (!this.#moveArmed || !this.#validSelectedMove(point)) return false;
    this.#movePreview = { ...point };
    return true;
  }

  commitMove(point = this.#movePreview): boolean {
    if (!this.#moveArmed || !point || !this.#validSelectedMove(point)) {
      this.cancelMove();
      return false;
    }
    const index = this.selectedIndex;
    if (index === undefined) {
      this.cancelMove();
      return false;
    }
    const vertex = this.#vertices[index];
    if (samePoint(vertex.position, point)) {
      this.cancelMove();
      return false;
    }
    this.#vertices = this.#vertices.map((candidate) =>
      candidate.id === vertex.id ? { ...candidate, position: { ...point } } : candidate,
    );
    this.#pushHistory({ kind: 'move', vertexId: vertex.id, prior: { ...vertex.position } });
    this.cancelMove();
    return true;
  }

  moveSelected(point: LatLon): boolean {
    if (!this.armMove()) return false;
    return this.commitMove(point);
  }

  cancelMove(): void {
    this.#moveArmed = false;
    this.#movePreview = undefined;
  }

  deleteSelected(): boolean {
    const index = this.selectedIndex;
    if (index === undefined || !this.canDeleteSelected) return false;
    const vertex = this.#vertices[index];
    this.cancelMove();
    this.#vertices = [...this.#vertices.slice(0, index), ...this.#vertices.slice(index + 1)];
    this.#pushHistory({
      kind: 'delete',
      vertex: { ...vertex, position: { ...vertex.position } },
      index,
    });
    this.#selectedId = this.#vertices[index]?.id ?? this.#vertices[index - 1]?.id;
    return true;
  }

  undo(): void {
    this.cancelMove();
    const entry = this.#history.at(-1);
    if (!entry) return;
    this.#history = this.#history.slice(0, -1);
    switch (entry.kind) {
      case 'add':
        this.#vertices = this.#vertices.filter((vertex) => vertex.id !== entry.vertexId);
        if (this.#selectedId === entry.vertexId) this.#selectedId = undefined;
        break;
      case 'move':
        this.#vertices = this.#vertices.map((vertex) =>
          vertex.id === entry.vertexId ? { ...vertex, position: { ...entry.prior } } : vertex,
        );
        this.#selectedId = entry.vertexId;
        break;
      case 'delete': {
        const insertAt = Math.min(entry.index, this.#vertices.length);
        this.#vertices = [
          ...this.#vertices.slice(0, insertAt),
          { ...entry.vertex, position: { ...entry.vertex.position } },
          ...this.#vertices.slice(insertAt),
        ];
        this.#selectedId = entry.vertex.id;
        break;
      }
    }
  }

  clear(): void {
    this.#vertices = [];
    this.#history = [];
    this.#selectedId = undefined;
    this.cancelMove();
  }

  #validSelectedMove(point: LatLon): boolean {
    if (!isLatLon(point)) return false;
    const index = this.selectedIndex;
    if (index === undefined) return false;
    return (
      !samePoint(this.#vertices[index - 1]?.position, point) &&
      !samePoint(this.#vertices[index + 1]?.position, point)
    );
  }

  #pushHistory(entry: MeasureHistoryEntry): void {
    this.#history = [...this.#history, entry].slice(-MAX_MEASURE_HISTORY);
  }

  #resetSession(): void {
    this.#vertices = [];
    this.#history = [];
    this.#selectedId = undefined;
    this.#moveArmed = false;
    this.#movePreview = undefined;
  }
}
