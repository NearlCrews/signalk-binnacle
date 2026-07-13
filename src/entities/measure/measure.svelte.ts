import { isLatLon, type LatLon } from '$shared/geo';
import { rhumbBearingRad, rhumbDistanceMeters } from '$shared/nav';

export const MAX_MEASURE_POINTS = 1_000;

export interface MeasureLeg {
  from: LatLon;
  to: LatLon;
  distanceMeters: number;
  bearingRad: number;
}

// The measure tool's state: an armed flag and the tapped points. Legs and the running total are
// derived, so the strip and the overlay read one source. Transient by design: nothing persists,
// and stopping the tool clears the points.
export class MeasureStore {
  #active = $state(false);
  #points = $state<LatLon[]>([]);

  get active(): boolean {
    return this.#active;
  }

  get points(): readonly LatLon[] {
    return this.#points;
  }

  get isEmpty(): boolean {
    return this.#points.length === 0;
  }

  get atLimit(): boolean {
    return this.#points.length >= MAX_MEASURE_POINTS;
  }

  legs = $derived.by<MeasureLeg[]>(() => {
    const out: MeasureLeg[] = [];
    for (let i = 1; i < this.#points.length; i += 1) {
      const from = this.#points[i - 1];
      const to = this.#points[i];
      // Rhumb distance with the rhumb bearing, so each leg reads as one consistent geometry: the
      // constant-bearing line a helmsman would actually steer between the tapped points.
      out.push({
        from,
        to,
        distanceMeters: rhumbDistanceMeters(from, to),
        bearingRad: rhumbBearingRad(from, to),
      });
    }
    return out;
  });

  get lastLeg(): MeasureLeg | undefined {
    return this.legs[this.legs.length - 1];
  }

  #total = $derived.by<number>(() => {
    let total = 0;
    for (const leg of this.legs) total += leg.distanceMeters;
    return total;
  });

  get totalMeters(): number {
    return this.#total;
  }

  // Arm the tool with a clean slate; chart taps then append points.
  start(): void {
    this.#points = [];
    this.#active = true;
  }

  stop(): void {
    this.#active = false;
    this.#points = [];
  }

  add(point: LatLon): boolean {
    if (!this.#active || this.atLimit || !isLatLon(point)) return false;
    const last = this.#points.at(-1);
    if (last?.latitude === point.latitude && last.longitude === point.longitude) return false;
    // Replace the array instead of mutating it. The overlay uses reference identity as its cheap
    // dirty check, so every accepted point must produce a new reference.
    this.#points = [...this.#points, { ...point }];
    return true;
  }

  undo(): void {
    this.#points = this.#points.slice(0, -1);
  }

  clear(): void {
    this.#points = [];
  }
}
