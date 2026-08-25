import { haversineMeters } from '$shared/nav';
import type {
  CurrentReading,
  NearbyTideStation,
  TideReading,
  TideSelectionSnapshot,
  TideStation,
  TideStationKind,
  TideStationLoadFailure,
  TideStationSelection,
  TidesSource,
  TidesStatus,
} from './tides-types';
import { MAX_NEARBY_STATIONS } from './tides-types';

const automaticSelection = (): TideStationSelection => ({ mode: 'automatic' });

export interface TidesLoadResult {
  nearbyTideStations?: NearbyTideStation[];
  nearbyCurrentStations?: NearbyTideStation[];
  tide:
    | {
        state: 'accepted';
        reading: TideReading;
        source: TidesSource;
        selection: TideStationSelection;
      }
    | { state: 'no-coverage'; selection: TideStationSelection }
    | { state: 'failed'; selection: TideStationSelection };
  current:
    | {
        state: 'accepted';
        reading: CurrentReading;
        selection: TideStationSelection;
      }
    | { state: 'no-coverage'; selection: TideStationSelection }
    | { state: 'failed'; selection: TideStationSelection };
}

function selectionAtDistance(
  selection: TideStationSelection,
  lat: number,
  lon: number,
): TideStationSelection {
  if (selection.mode === 'automatic') return selection;
  return {
    ...selection,
    distanceMeters: haversineMeters(
      lat,
      lon,
      selection.station.latitude,
      selection.station.longitude,
    ),
  };
}

function readingAtDistance<R extends TideReading | CurrentReading>(
  reading: R | undefined,
  lat: number,
  lon: number,
): R | undefined {
  if (!reading) return undefined;
  return {
    ...reading,
    distanceMeters: haversineMeters(lat, lon, reading.station.latitude, reading.station.longitude),
  };
}

// The tide and tidal-current state, including independent station intent and the bounded NOAA
// catalogs. Cross-feature data flows through this store, never feature to feature.
export class TidesStore {
  status = $state<TidesStatus>('idle');
  // The accepted tide station and its day of high and low events, or undefined when none is in
  // range. A manual station with a valid empty response remains accepted with an empty events array.
  tide = $state.raw<TideReading | undefined>(undefined);
  // The accepted current station and its flood, ebb, and slack events.
  current = $state.raw<CurrentReading | undefined>(undefined);
  // Which source served the accepted tide reading. A failed replacement keeps this provenance.
  source = $state<TidesSource | undefined>(undefined);
  nearbyTideStations = $state.raw<NearbyTideStation[]>([]);
  nearbyCurrentStations = $state.raw<NearbyTideStation[]>([]);
  requestedTide = $state.raw<TideStationSelection>(automaticSelection());
  requestedCurrent = $state.raw<TideStationSelection>(automaticSelection());
  loadedTide = $state.raw<TideStationSelection>(automaticSelection());
  loadedCurrent = $state.raw<TideStationSelection>(automaticSelection());
  failures = $state.raw<TideStationLoadFailure[]>([]);
  // Marker selections bump this even when the same row is selected, so a minimized panel expands.
  selectionRevision = $state(0);

  selectionSnapshot(): TideSelectionSnapshot {
    return { tide: this.requestedTide, current: this.requestedCurrent };
  }

  requested(kind: TideStationKind): TideStationSelection {
    return kind === 'tide' ? this.requestedTide : this.requestedCurrent;
  }

  loaded(kind: TideStationKind): TideStationSelection {
    return kind === 'tide' ? this.loadedTide : this.loadedCurrent;
  }

  nearby(kind: TideStationKind): NearbyTideStation[] {
    return kind === 'tide' ? this.nearbyTideStations : this.nearbyCurrentStations;
  }

  reading(kind: TideStationKind): TideReading | CurrentReading | undefined {
    return kind === 'tide' ? this.tide : this.current;
  }

  failure(kind: TideStationKind): TideStationLoadFailure | undefined {
    return this.failures.find((failure) => failure.kind === kind);
  }

  requestManual(kind: TideStationKind, station: TideStation, distanceMeters: number): void {
    const selection: TideStationSelection = { mode: 'manual', station, distanceMeters };
    if (kind === 'tide') this.requestedTide = selection;
    else this.requestedCurrent = selection;
    this.selectionRevision += 1;
  }

  requestAutomatic(kind: TideStationKind): void {
    if (kind === 'tide') this.requestedTide = automaticSelection();
    else this.requestedCurrent = automaticSelection();
    this.selectionRevision += 1;
  }

  requestAllAutomatic(): void {
    this.requestedTide = automaticSelection();
    this.requestedCurrent = automaticSelection();
    this.selectionRevision += 1;
  }

  // Resolve an untrusted map feature against station objects already admitted to bounded state.
  resolveStation(kind: TideStationKind, stationId: string): TideStation | undefined {
    const nearby = this.nearby(kind).find((candidate) => candidate.station.id === stationId);
    if (nearby) return nearby.station;
    const requested = this.requested(kind);
    if (requested.mode === 'manual' && requested.station.id === stationId) {
      return requested.station;
    }
    const loaded = this.loaded(kind);
    if (loaded.mode === 'manual' && loaded.station.id === stationId) return loaded.station;
    const reading = this.reading(kind);
    return reading?.station.id === stationId ? reading.station : undefined;
  }

  // Pans update every displayed straight-line distance immediately, including a manual selection
  // outside the latest nearby catalog. The loader later replaces the bounded catalogs if it can.
  recalculateDistances(lat: number, lon: number): void {
    const recalculate = (candidate: NearbyTideStation): NearbyTideStation => ({
      ...candidate,
      distanceMeters: haversineMeters(
        lat,
        lon,
        candidate.station.latitude,
        candidate.station.longitude,
      ),
    });
    const byDistance = (a: NearbyTideStation, b: NearbyTideStation) =>
      a.distanceMeters - b.distanceMeters;
    this.nearbyTideStations = this.nearbyTideStations.map(recalculate).sort(byDistance);
    this.nearbyCurrentStations = this.nearbyCurrentStations.map(recalculate).sort(byDistance);
    this.requestedTide = selectionAtDistance(this.requestedTide, lat, lon);
    this.requestedCurrent = selectionAtDistance(this.requestedCurrent, lat, lon);
    this.loadedTide = selectionAtDistance(this.loadedTide, lat, lon);
    this.loadedCurrent = selectionAtDistance(this.loadedCurrent, lat, lon);
    this.tide = readingAtDistance(this.tide, lat, lon);
    this.current = readingAtDistance(this.current, lat, lon);
  }

  setLoading(): void {
    this.failures = [];
    this.status = 'loading';
  }

  setCatalogs(tide: NearbyTideStation[], current: NearbyTideStation[]): void {
    this.nearbyTideStations = tide.slice(0, MAX_NEARBY_STATIONS);
    this.nearbyCurrentStations = current.slice(0, MAX_NEARBY_STATIONS);
  }

  applyLoad(result: TidesLoadResult): void {
    if (result.nearbyTideStations) {
      this.nearbyTideStations = result.nearbyTideStations.slice(0, MAX_NEARBY_STATIONS);
    }
    if (result.nearbyCurrentStations) {
      this.nearbyCurrentStations = result.nearbyCurrentStations.slice(0, MAX_NEARBY_STATIONS);
    }

    const failures: TideStationLoadFailure[] = [];
    if (result.tide.state === 'accepted') {
      this.tide = result.tide.reading;
      this.source = result.tide.source;
      this.loadedTide = result.tide.selection;
    } else if (result.tide.state === 'no-coverage') {
      this.tide = undefined;
      this.source = undefined;
      this.loadedTide = result.tide.selection;
    } else {
      failures.push({ kind: 'tide', requested: result.tide.selection });
    }

    if (result.current.state === 'accepted') {
      this.current = result.current.reading;
      this.loadedCurrent = result.current.selection;
    } else if (result.current.state === 'no-coverage') {
      this.current = undefined;
      this.loadedCurrent = result.current.selection;
    } else {
      failures.push({ kind: 'current', requested: result.current.selection });
    }
    this.failures = failures;
    this.status = failures.length > 0 ? 'error' : this.tide ? 'ready' : 'no-coverage';
  }

  // Compatibility helpers for focused store and overlay tests.
  setReadings(
    tide: TideReading | undefined,
    current: CurrentReading | undefined,
    source?: TidesSource,
  ): void {
    this.tide = tide;
    this.current = current;
    this.source = tide ? source : undefined;
    this.failures = [];
    this.status = tide ? 'ready' : 'no-coverage';
  }

  setNoCoverage(): void {
    this.tide = undefined;
    this.current = undefined;
    this.source = undefined;
    this.failures = [];
    this.status = 'no-coverage';
  }
}
